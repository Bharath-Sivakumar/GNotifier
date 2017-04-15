/**
 * GNotifier - Firefox/Thunderbird add-on that replaces
 * built-in notifications with the OS native notifications
 *
 * Licensed under GNU General Public License 3.0 or later.
 * Some rights reserved. See COPYING, AUTHORS.
 *
 * @license GPL-3.0 <https://www.gnu.org/licenses/gpl-3.0.html>
 */

const {Cc, Ci, Cu} = require("chrome");

const _ = require("sdk/l10n").get;
const sps = require("sdk/simple-prefs").prefs;
const ps = require("sdk/preferences/service");

Cu.import("resource://app/modules/gloda/mimemsg.js");
Cu.import("resource://gre/modules/Timer.jsm");

const gHeaderParser = Cc["@mozilla.org/messenger/headerparser;1"].getService(Ci.nsIMsgHeaderParser);
const gMessenger = Cc["@mozilla.org/messenger;1"].getService(Ci.nsIMessenger);
const system = require("sdk/system");
const utils = require("./utils.js");

//var app = Cc["@mozilla.org/steel/application;1"].getService(Ci.steelIApplication);

let bufferedMessages = [];
let timeoutID;

function getUnreadMessageCount() {
  // Getting unread messages count
  let newMailNotificationService = Cc["@mozilla.org/newMailNotificationService;1"].getService(Ci.mozINewMailNotificationService);
  return newMailNotificationService.messageCount;
}

function showMessageNotification(message) {
  if (isFolderRSS(message.folder)) {
    showNewRSSNotification(message);
  } else {
    showNewEmailNotification(message);
  }
}

function showNewRSSNotification(message) {
  let author = message.mime2DecodedAuthor;
  // unicode character ranges taken from:
  // http://stackoverflow.com/questions/1073412/javascript-validation-issue-with-international-characters#1073545
  const author_regex = /^["']?([A-Za-z\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF\s]+)["']?\s<.+?>$/;
  // check if author has name and email
  if (author_regex.test(author)) {
    // retrieve only name portion of author string
    author = author.match(author_regex)[1];
  }
  let title = _("New_article_from") + " " + author;
  let text = message.mime2DecodedSubject;

  showNotification(title, text, message);
}

function isFolderRSS(folder) {
  let rootURIarr = folder.rootFolder.URI.split("@");
  return (rootURIarr[rootURIarr.length-1].indexOf("Feeds") !== -1);
}

function bufferNewEmailNotification(message) {
  clearTimeout(timeoutID);
  bufferedMessages.push(message);
  timeoutID = setTimeout(()=>{showNewEmailNotificationFromBuffer();}, 1000);
}

function showNewEmailNotificationFromBuffer() {
  if (sps.maxMessageBuffer > 0 && bufferedMessages.length > sps.maxMessageBuffer) {
    showAggregatedNotification();
  } else {
    for (var i = 0; i < bufferedMessages.length; i++) {
      showMessageNotification(bufferedMessages[i]);
    }
  }

  bufferedMessages = [];
  timeoutID = null;
}

function showAggregatedNotification() {
  let title = format2(sps.aggregatedEmailTitleFormat);
  let text = formatAggregated(sps.aggregatedEmailTextFormat.replace(/\\n/, "\n"));
  console.log("showAggregatedNotification");
  console.log("title: " + title);
  console.log("text: " + text);

  showClickableNotification(title, text,
    system.name === "SeaMonkey" ? null : ()=>focusWindow(true));
}

function showNewEmailNotification(message) {
  let title = format(message, sps.emailTitleFormat);
  let text = format(message, sps.emailTextFormat.replace(/\\n/, "\n"));
  showNotification(title, text, message);
}

function showNotification(title, text, message){
  const notifications = require("sdk/notifications");

  // Current implementation of click action doesn't support SeaMonkey,
  // so doing not clickable notification if SeaMonkey
  if (system.name === "SeaMonkey") {
    notifications.notify({
      title: title,
      text: text,
      iconURL: utils.getIcon()
    });
    return;
  }

  // Doing notification with buttons if Linux and buttons are supported in
  // the notify server
  if (sps.engine === 1 && system.platform === "linux") {
    const notifApi = require("./linux.js");

    let id = null;
    let actions = null;
    if (message) {
      if (sps.clickOptionNewEmail === 0) {
        actions = [{
          label: _("open"),
          handler: ()=>{
            display(message);
            notifApi.close(id);
          }
        }, {
          label: _("Mark_as_read"),
          handler: ()=>{
            message.markRead(true);
            notifApi.close(id);
          }
        }];
      } else {
        actions = [{
          label: _("Mark_as_read"),
          handler: ()=>{
            message.markRead(true);
            notifApi.close(id);
          }
        }, {
          label: _("open"),
          handler: ()=>{
            display(message);
            notifApi.close(id);
          }
        }];
      }

      if (notifApi.checkButtonsSupported()) {
        /* eslint-disable no-unused-vars */
        id = notifApi.notifyWithActions(utils.getIcon(), title, text,
          system.name, reason=>{}, actions);
          /* eslint-enable no-unused-vars */
        console.log("notifyWithActions, id: " + id);
        if (message && id)
          message.setStringProperty("gnotifier-notification-id", id);
        return;
      }

      /* eslint-disable no-unused-vars */
      id = notifApi.notify(utils.getIcon(), title, text, system.name,
        reason=>{}, data=>{
          display(message);
          notifApi.close(id);
        });
        /* eslint-enable no-unused-vars */
      console.log("notify, id: " + id);
      if (message && id)
        message.setStringProperty("gnotifier-notification-id", id);
      return;
    }
  }

  if (message) {
    notifications.notify({
      title: title,
      text: text,
      iconURL: utils.getIcon(),
/* eslint-disable no-unused-vars */
      onClick: data=>{display(message);}
/* eslint-enable no-unused-vars */
    });
    return;
  }

  notifications.notify({
    title: title,
    text: text,
    iconURL: utils.getIcon()
  });
}

function showClickableNotification(title, text, clickHandler) {
  if (sps.engine === 1 && system.platform === "linux") {
    const notifApi = require("./linux.js");
    /* eslint-disable no-unused-vars */
    let id = notifApi.notify(utils.getIcon(), title, text, system.name,
      reason=>{}, data=>{
        if (clickHandler) {
          clickHandler();
          notifApi.close(id);
        }
      });
    /* eslint-enable no-unused-vars */
  } else {
    const notifications = require("sdk/notifications");
    if (clickHandler) {
      notifications.notify({
        title: title,
        text: text,
        iconURL: utils.getIcon(),
        onClick: clickHandler
      });
    } else {
      notifications.notify({
        title: title,
        text: text,
        iconURL: utils.getIcon()
      });
    }
  }
}

function focusWindow(selectTabmail) {
  const win = Cc["@mozilla.org/appshell/window-mediator;1"]
    .getService(Ci.nsIWindowMediator).getMostRecentWindow("mail:3pane");
  if (win) {
    if (selectTabmail) {
      let tabmail = win.document.getElementById("tabmail");
      if (tabmail)
        tabmail.switchToTab(0);
    }
    // On Windows, bring TB window to the front
    if (system.platform === "winnt") {
      require("./windowsUtils.js").forceFocus(win);
    } else {
      win.focus();
    }
  }
}

// Display a given message. Heavily inspired by
// https://developer.mozilla.org/docs/Mozilla/Thunderbird/Content_Tabs
function display(message) {
  // Try opening new tabs in an existing 3pane window
  const win = Cc["@mozilla.org/appshell/window-mediator;1"]
    .getService(Ci.nsIWindowMediator).getMostRecentWindow("mail:3pane");
  if (win) {
    //INFO: tabmail is not supported in SeaMonkey
    let tabmail = win.document.getElementById("tabmail");
    if (sps.newMailOpen == 0) {
      if (tabmail)
        tabmail.openTab("message", {msgHdr: message});
    } else {
      if (tabmail)
        tabmail.switchToTab(0);
      win.gFolderDisplay.show(message.folder);
      win.gFolderDisplay.selectMessage(message);
    }

    focusWindow(false);
    return;
  }

  // If no window to open in can be found, fall back
  // to any window and spwan a new one from there.
  require("sdk/window/utils").windows()[0].openDialog(
    "chrome://messenger/content/messageWindow.xul",
    "_blank",
    "all,chrome,dialog=no,status,toolbar",
    message
  );
}

function formatAggregated(formatRe){
  let string = format2(formatRe);
  string = string.replace(new RegExp("%\\[(.+)\\]\{(.+)\}", "g"), (match, p1, p2)=>{
    let n = parseInt(p2);
    if (n == 0)
      n = 1;
    else if (n > 10)
      n = 10;
    else if (n < -10)
      n = -10;

    let text = "";
    let maxn = bufferedMessages.length;
    if (n > 0) {
      n = n > maxn ? maxn : n;
      for (let i = 0; i<n; i++) {
        text += (format(bufferedMessages[i], p1));
        if (i != n-1)
          text += "\n";
      }
    } else {
      n = n < -maxn ? maxn : -n;
      for (let i = maxn-1; i>maxn-n-1; i--) {
        text += (format(bufferedMessages[i], p1));
        if (i != maxn-n)
          text += "\n";
      }
    }
    return text;
  });
  return string;
}

function formatL10n(formatRe){
  return formatRe.replace(new RegExp("%_(\\w+)", "g"), (match, p1)=>{
    return _(p1);
  });
}

function format2(formatRe){
  let string = formatL10n(formatRe);
  string = string.replace(new RegExp("(%[cC%])", "g"), (match, p1)=>{
    switch(p1) {
    // Number of new messages
    case "%C":
      return bufferedMessages.length;
    // Numer of unread messages
    case "%c":
      return getUnreadMessageCount();
    case "%%":
      return "%";
    }
  });
  return string;
}

function format(message, formatRe){
  let author = gHeaderParser.parseDecodedHeader(message.mime2DecodedAuthor);
  let string = formatRe.replace(new RegExp("(%[samnfvkubc%])", "g"), (match, p1)=>{
    switch(p1){
    // Subject, with "Re:" when appropriate
    case "%s": {
      let hasRe = message.flags & Ci.nsMsgMessageFlags.HasRe;
      let subject = message.mime2DecodedSubject == "" ? _("Empty_subject") : message.mime2DecodedSubject;
      return hasRe ? "Re: " + subject : subject;
    }
    // Full Author
    case "%a":
      return message.mime2DecodedAuthor;
    // Author e-mail address only
    case "%m":
      return author[0].email;
    // Author name only
    case "%n":
      return author[0].name;
    // Folder
    case "%f":
      return message.folder.prettiestName;
    // Server
    case "%v":
      return message.folder.server.hostName;
    // Size
    case "%k":
      return gMessenger.formatFileSize(message.messageSize);
    // Account name
    case "%u":
      return message.folder.server.prettyName;
    // Body excerpt
    case "%b": {
      let body = getMessageBody(message);
      body = body.replace(/\n/g, " ").trim().substr(0, 80).trim();
      body += body.length > 80 ? "..." : "";
      return body == "" ? _("Empty_body") : body;
    }
    // Numer of unread messages
    case "%c":
      return getUnreadMessageCount();
    // Percent
    case "%%":
      return "%";
    }
  });
  //callback(string);
  return string;
}

function getMessageBody(aMsgHdr){
  const listener = Cc["@mozilla.org/network/sync-stream-listener;1"]
    .createInstance(Ci.nsISyncStreamListener);
  let uri = aMsgHdr.folder.getUriForMsg(aMsgHdr);
  gMessenger.messageServiceFromURI(uri).streamMessage(uri, listener, null, null, false, "");
  let folder = aMsgHdr.folder;
  return folder.getMsgTextFromStream(listener.inputStream, aMsgHdr.Charset,
    65536, 100, false, true,{ });
}

function selectedMessage() {
  const win = Cc["@mozilla.org/appshell/window-mediator;1"]
    .getService(Ci.nsIWindowMediator).getMostRecentWindow("mail:3pane");
  if (win && win.gFolderDisplay && win.gFolderDisplay.selectedMessage) {
    // Folder filtering test
    let folder = win.gFolderDisplay.selectedMessage.folder;
    if (isFolderExcluded(folder) || !isFolderAllowed(folder)) {
      let name = folder.rootFolder.prettiestName + "|" + folder.prettiestName;
      utils.showGnotifierNotification("Notifications from folder \"" + name + "\" are disabled.");
      return null;
    }
    return win.gFolderDisplay.selectedMessage;
  } else {
    utils.showGnotifierNotification("You need to select a message to make a test.");
    return null;
  }
}

function testNotification() {
  let message = selectedMessage();
  if (message)
    showMessageNotification(message);
}

function testAggregatedNotification() {
  let sMessage = selectedMessage();
  if (sMessage) {
    bufferedMessages = [];

    let i = 0;
    let messages = sMessage.folder.messages;
    while (messages.hasMoreElements()) {
      let message = messages.getNext().QueryInterface(Ci.nsIMsgDBHdr);
      bufferedMessages.push(message);
      i++;
      if (i > 9)
        break;
    }

    showAggregatedNotification();
    bufferedMessages = [];
  }
}

function isFolderExcluded(folder) {
  // Reference: https://mxr.mozilla.org/comm-central/source/mailnews/base/public/nsMsgFolderFlags.idl
  // Junk
  if (folder.getFlag(0x40000000))
    return true;
  // Trash
  if (folder.getFlag(0x00000100))
    return true;
  // SentMail
  // Commented due to https://github.com/mkiol/GNotifier/issues/153
  /*if (folder.getFlag(0x00000200))
    return true;*/
  // Drafts
  if (folder.getFlag(0x00000400))
    return true;
  // Archive
  if (folder.getFlag(0x00004000))
    return true;
  // Templates
  if (folder.getFlag(0x00400000))
    return true;
  return false;
}

function isFolderAllowed(folder) {
  // Allow user to filter specific folders.
  let foldersAllowedListPref = sps["foldersAllowedList"].trim();
  if (foldersAllowedListPref !== "") {
    let foldersAllowedList = foldersAllowedListPref.split(",");
    for (let i = 0; i < foldersAllowedList.length; i++) {
      let folderName1 = foldersAllowedList[i].toLowerCase().trim();
      let folderName2;
      if (folderName1.indexOf("|") !== -1) {
        // Folder name contains rootFolder name
        folderName2 = folder.rootFolder.prettiestName.toLowerCase() + "|" + folder.prettiestName.toLowerCase();
      } else {
        folderName2 = folder.prettiestName.toLowerCase();
      }
      if (folderName1 == folderName2) {
        return true;
      }
    }
  } else {
    //allow all folders if setting is empty
    return true;
  }
  return false;
}

/*function getFoldersWithNewMail(aFolder) {
  let folderList = [];
  if (aFolder) {
    if (aFolder.biffState == Ci.nsIMsgFolder.nsMsgBiffState_NewMail) {
      if (aFolder.hasNewMessages) {
        folderList.push(aFolder);
        //console.log("aFolder: " + aFolder.prettiestName);
        //console.log("aFolder.rootFolder: " + aFolder.rootFolder.prettiestName);
      }
      if (aFolder.hasSubFolders) {
        let subFolders = aFolder.subFolders;
        while (subFolders.hasMoreElements()) {
          let subFolder = subFolders.getNext().QueryInterface(Ci.nsIMsgFolder);
          if (subFolder)
            folderList = folderList.concat(getFoldersWithNewMail(subFolder));
        }
      }
    }
  }
  return folderList;
}*/

function handleNewMessage(message) {
  let folder = message.folder;

  if (!sps.enableRSS && isFolderRSS(folder)) {
    // Notifications for RSS are disabled
    return;
  }

  if (!isFolderExcluded(folder) && isFolderAllowed(folder)) {
    if (message.getUint32Property("gnotifier-done") != 1) {
      bufferNewEmailNotification(message);
      message.setUint32Property("gnotifier-done", 1);
    }
  }
}

var mailListener = {
  OnItemAdded: (parentItem, item)=>{
    console.log("OnItemAdded");
    let message = item.QueryInterface(Ci.nsIMsgDBHdr);
    console.log("message subject: " + message.mime2DecodedSubject);
    if (message.flags & Ci.nsMsgMessageFlags.New) {
      console.log("new message");
      handleNewMessage(message);
    }
  },

  OnItemPropertyFlagChanged: (message, atom, oldFlag, newFlag)=>{
    /*console.log("OnItemPropertyFlagChanged");
    console.log("message subject: " + message.mime2DecodedSubject);
    console.log("oldFlag: " + oldFlag);
    console.log("newFlag: " + newFlag);
    console.log("oldFlag-newFlag: " + (oldFlag-newFlag));
    console.log("oldFlag isRead: " + ((oldFlag & Ci.nsMsgMessageFlags.Read) ? "true" : "false"));
    console.log("newFlag isRead: " + ((newFlag & Ci.nsMsgMessageFlags.Read) ? "true" : "false"));*/
    if ((newFlag & Ci.nsMsgMessageFlags.Read) &&
        !(oldFlag & Ci.nsMsgMessageFlags.Read)) {
      const id = message.getStringProperty("gnotifier-notification-id");
      if (id) {
        console.log("Message marked as read and has notification_id="+id+" property");
        if (sps["engine"] === 1 && system.platform === "linux") {
          const notifApi = require("./linux.js");
          notifApi.close(id);
          message.setStringProperty("gnotifier-notification-id","");
        }
      }
    }
  }/*,
  OnItemIntPropertyChanged: function (aItem,aProperty,aOldValue,aNewValue) {
    if (!sps["enableRSS"] && isFolderRSS(aItem)) {
      // Notifications for RSS are disabled
      return;
    }

    // New mail if BiffState == nsMsgBiffState_NewMail or NewMailReceived
    if (
      (aProperty == "BiffState" && aNewValue == Ci.nsIMsgFolder.nsMsgBiffState_NewMail &&
        (aOldValue == Ci.nsIMsgFolder.nsMsgBiffState_NoMail || aOldValue == Ci.nsIMsgFolder.nsMsgBiffState_Unknown)) ||
      (aProperty == "NewMailReceived")
    ) {

      //console.log("aItem: " + aItem.prettiestName);
      //console.log("aItem.rootFolder: " + aItem.rootFolder.prettiestName);
      let folderList = getFoldersWithNewMail(aItem.rootFolder);
      //let folderList = getFoldersWithNewMail(aItem);
      if (folderList.length == 0) {
        // Can't find folder with BiffState == nsMsgBiffState_NewMail
        return;
      }

      for (let i in folderList) {
        if (folderList[i]) {
          let folder = folderList[i];
          if (!isFolderExcluded(folder) && isFolderAllowed(folder)) {
            // Looking for messages with flag == Ci.nsMsgMessageFlags.New
            let messages = folder.messages;
            while (messages.hasMoreElements()) {
              let message = messages.getNext().QueryInterface(Ci.nsIMsgDBHdr);
              if (message.flags & Ci.nsMsgMessageFlags.New) {
                handleNewMessage(message);
              }
            }
          }
        }
      }
    }
  }*/
};

exports.init = ()=>{
  // Disabling native new email alert
  ps.set("mail.biff.show_alert", false);

  // Folder listeners registration for OnItemIntPropertyChanged
  const folderListenerManager = Cc["@mozilla.org/messenger/services/session;1"]
    .getService(Ci.nsIMsgMailSession);

  // On Linux listening also for "read" flag change for hiding notification
  // when message is marked as read
  if (system.platform === "linux")
    folderListenerManager.AddFolderListener(mailListener,
      Ci.nsIFolderListener.added | Ci.nsIFolderListener.propertyFlagChanged
      // | Ci.nsIFolderListener.intPropertyChanged
    );
  else
    folderListenerManager.AddFolderListener(mailListener,
      Ci.nsIFolderListener.added // | Ci.nsIFolderListener.intPropertyChanged
    );

  const sp = require("sdk/simple-prefs");
  sp.on("test", ()=>{
    testNotification();
  });
  sp.on("testAggregated", ()=>{
    testAggregatedNotification();
  });
};

exports.deInit = ()=>{
  bufferedMessages = [];

  // Enabling native new email alert
  ps.set("mail.biff.show_alert", true);

  const folderListenerManager = Cc["@mozilla.org/messenger/services/session;1"]
    .getService(Ci.nsIMsgMailSession);
  folderListenerManager.RemoveFolderListener(mailListener);
};
