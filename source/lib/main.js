/**
 * GNotifier - Firefox/Thunderbird add-on that replaces
 * built-in notifications with the OS native notifications
 *
 * Copyright 2014 by Michal Kosciesza <michal@mkiol.net>
 * Copyright 2014 by Alexander Schlarb <alexander1066@xmine128.tk>
 * Copyright 2014 by Joe Simpson <headbangerkenny@gmail.com>
 *
 * Licensed under GNU General Public License 3.0 or later.
 * Some rights reserved. See COPYING, AUTHORS.
 *
 * @license GPL-3.0 <https://www.gnu.org/licenses/gpl-3.0.html>
 */

var data = require('sdk/self').data;
var _ = require('sdk/l10n').get;

var { Cc, Ci, Cu, Cm, Cr, components } = require('chrome');
Cu.import("resource://gre/modules/Timer.jsm");
Cu.import("resource://gre/modules/FileUtils.jsm");
Cu.import("resource://gre/modules/NetUtil.jsm");
Cu.import('resource://gre/modules/XPCOMUtils.jsm');
Cu.import("resource://gre/modules/Task.jsm");
Cu.import("resource://gre/modules/Downloads.jsm");
var sps = require("sdk/simple-prefs").prefs;
var system = require("sdk/system");
var origAlertsServiceFactory = Cm.getClassObject(Cc["@mozilla.org/alerts-service;1"], Ci.nsIFactory);
var origAlertsService = Cc["@mozilla.org/alerts-service;1"].getService(Ci.nsIAlertsService);
//var app = Cc["@mozilla.org/steel/application;1"].getService(Ci.steelIApplication);
//var io = Cc["@mozilla.org/network/io-service;1"].getService(Ci.nsIIOService);

var loaded = false;

// Determine Linux / OSX based on 'system.platform'
var notifApi;
if (system.platform === "darwin"){
    notifApi = require("./osx.js");
} else if (system.platform === "winnt") {
    notifApi = require("./windows.js");
} else {
    notifApi = require("./linux.js");
}

function showDownloadCompleteNotification(path, dir, filename) {
    var utils = require("./utils.js");
    var title = _("download_finished");
    var text = filename;

    // if engine = 1 & linux & supports action buttons -> adding 2 actions: open file & open folder
    if (sps['engine'] === 1 && system.platform === "linux" && notifApi.checkButtonsSupported()) {

        // Fix for Plasma4: Space on buttons is small so using short labels
        var plasma = notifApi.checkPlasma();

        var actions;
        //console.log("showDownloadCompleteNotification path: "+path+", dir="+dir+", filename="+filename);
        if (sps['clickOption'] == 0) {
            actions = [{
                label: plasma ? _("Folder") : _("Open_folder"),
                handler: function() {utils.openFile("file://"+dir)}
            }, {
                label: plasma ? _("File") : _("Open_file"),
                handler: function() {utils.openFile("file://"+path)}
            }];
        } else {
            actions = [{
                label: plasma ? _("File") : _("Open_file"),
                handler: function() {utils.openFile("file://"+path)}
            }, {
                label: plasma ? _("Folder") : _("Open_folder"),
                handler: function() {utils.openFile("file://"+dir)}
            }];
        }

        // if success, return, if not trying standard notification
        if (notifApi.notifyWithActions(utils.getIcon(), title, text, system.name, function(reason) {}, actions))
          return;
    }

    // if linux and libnotify is inited, adding "Open" button
    // it only makes sense for some linux distros e.g. KDE, Gnome Shell
    if (sps['engine'] === 1 && system.platform === "linux" && loaded)
        text = text+"<input text='"+_("open")+"' type='submit'/>";

    var notifications = require("sdk/notifications");
    notifications.notify({
        title: title,
        text: text,
        iconURL: utils.getIcon(),
        onClick: function() {
                    if (sps['clickOption'] == 0) {
                        utils.openFile("file://" + dir);
                    } else {
                        utils.openFile("file://" + path);
                    };
                }
    });
}

// Works only for FF<26 and SeaMonkey
var downloadProgressListener = {
    onDownloadStateChange: function(aState, aDownload) {
        var dm = Cc["@mozilla.org/download-manager;1"].getService(Ci.nsIDownloadManager);
        if (sps['downloadCompleteAlert']) {
            switch(aDownload.state) {
            case dm.DOWNLOAD_FINISHED:
                showDownloadCompleteNotification(aDownload.target.path, aDownload.target.path.replace(/[^\\\/]*$/, ''), aDownload.displayName);
                break;
            }
        }
    }
}

// Works only for FF>=26
Task.spawn(function () {
    try {
        let list = yield Downloads.getList(Downloads.ALL);
        let view = {
            onDownloadChanged: function(download) {
                if(sps['downloadCompleteAlert'] && download.succeeded) {
                    if (download.target.exists === undefined || download.target.exists === true)
                        showDownloadCompleteNotification(download.target.path, download.target.path.replace(/[^\\\/]*$/, ''), download.target.path.replace(/^.*[\\\/]/, ''));
                }
            }
        };
        yield list.addView(view);
    } catch(e) {
        console.log("Unexpected exception ",e);
    }
}).then(null, Cu.reportError);


// New implmentation of Alert Service
function AlertsService()
{}
AlertsService.prototype = {
    QueryInterface: XPCOMUtils.generateQI([Ci.nsIAlertsService]),

    // New nsIAlertsService API (FF 46)
    showAlert: function(alert, alertListener) {
      this.showAlertNotification(alert.imageURL, alert.title, alert.text, alert.textClickable, alert.cookie, alertListener, alert.name, alert.dir, alert.lang);
    },

    showAlertNotification: function GNotifier_AlertsService_showAlertNotification(imageUrl, title, text, textClickable, cookie, alertListener, name, dir, lang) {
        // Choosing engine: 0 - FF built-in, 1 - native, 2 - custom command
        if (sps['engine'] === 0) {
          origAlertsService.showAlertNotification(imageUrl, title, text, textClickable, cookie, alertListener, name, dir, lang);
          return;
        }

        if (sps['engine'] === 2) {
          if (sps['command'] !== "") {
            var utils = require('./utils.js');
            var command = sps['command'];
            command = command.replace("%image",imageUrl);
            command = command.replace("%title",title);
            command = command.replace("%text",text);
            utils.execute(command);
          }
          return;
        }

        function GNotifier_AlertsService_showAlertNotification_cb(iconPath) {
            // Defing close handler
            var closeHandler = function(reason){
                // Generating "alertfinished"
                console.log(reason);
                if(alertListener) {
                    alertListener.observe(null, "alertfinished", cookie);
                }
            };

            // Defing click handler
            var clickHandler = textClickable ? function(){
                // Generating "alertclickcallback"
                if(alertListener) {
                    alertListener.observe(null, "alertclickcallback", cookie);
                }
            } : null;

            // Sending notification
            if (notifyNative(iconPath, title, text, name, closeHandler, clickHandler)) {
                // Generating "alertshow"
                if(alertListener) {
                    alertListener.observe(null, "alertshow", cookie);
                }
            } else {
                console.log("notifyNative fails!");
            }
        }

        // Needed for generating temp icon file
        function makeid() {
            var text = "";
            var possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
            for( var i=0; i < 6; i++ )
            text += possible.charAt(Math.floor(Math.random() * possible.length));
            return text;
        }

        if (!imageUrl) {
          GNotifier_AlertsService_showAlertNotification_cb("");
          return;
        }

        try {
            // Try using a local icon file URL
            var imageURI = NetUtil.newURI(imageUrl);
            var iconFile = imageURI.QueryInterface(Ci.nsIFileURL).file;

            // Success!
            GNotifier_AlertsService_showAlertNotification_cb(iconFile.path);
        } catch(e) {
            var tempIconFile;
            try {
                // Create temporary local file
                // (Required since I don't want to manually
                //  populate a GdkPixbuf...)
                tempIconFile = FileUtils.getFile("TmpD", ["gnotifier-"+makeid()]);
                tempIconFile.createUnique(
                    Ci.nsIFile.NORMAL_FILE_TYPE,
                    FileUtils.PERMS_FILE
                );
                var iconStream = FileUtils.openSafeFileOutputStream(tempIconFile);
                // Copy data from original icon to local file
                var imageFile = NetUtil.newChannel(imageUrl);
                NetUtil.asyncFetch(imageFile, function(imageStream,result) {
                    if (!components.isSuccessCode(result)) {
                        console.log("NetUtil.asyncFetch error! result:",result);
                        return;
                    }
                    NetUtil.asyncCopy(imageStream, iconStream, function(result) {
                        if (!components.isSuccessCode(result)) {
                            console.log("NetUtil.asyncCopy error! result:",result);
                            return;
                        }
                        // Show notification with copied icon file
                        GNotifier_AlertsService_showAlertNotification_cb(tempIconFile.path);
                        // Close streams
                        iconStream.close();
                        imageStream.close();
                    });
                });
                // Remove temp icon file
                setTimeout(function(){
                    tempIconFile.remove(false);
                },2000);

            } catch(e) {
                GNotifier_AlertsService_showAlertNotification_cb(imageUrl);
                // Remove temp icon file
                setTimeout(function(){
                    tempIconFile.remove(false);
                },2000);
            }
        }
    }
};

// FF notification
function notifyFF (iconURL, title, text) {
    // Unloading GNotifier implementaion of Alert service
    exports.onUnload();

    var notifications = require("sdk/notifications");
    notifications.notify({
        title: title,
        text: text,
        iconURL: iconURL
    });
}

// Native notification
function notifyNative (iconURL, title, text, notifier, closeHandler, clickHandler) {
    //console.log("notifier:",notifier);
    var ret = notifApi.notify(iconURL, title, text, system.name, closeHandler, clickHandler);
    if(!ret) {
        console.log('Native notification fails! :-(');
        //notifyFF(iconURL, title, text);
        return false;
    }
    return true;
}

function deleteTempFiles () {
    var tempDir = FileUtils.getDir("TmpD",[""]);
    var entries = tempDir.directoryEntries;
    while(entries.hasMoreElements()) {
        var entry = entries.getNext();
        entry.QueryInterface(Ci.nsIFile);
        var filename = entry.path.replace(/^.*[\\\/]/, '');
        //console.log(filename,filename.substring(0, 10) === "gnotifier-");
        if (filename.substring(0, 10) === "gnotifier-")
          entry.remove(false);
    }
}

function testNotification () {
    var utils = require('./utils.js');
    var notifications = require("sdk/notifications");
    notifications.notify({
        title: "GNotifier test",
        text: "This works only in the Thunderbird!",
        iconURL: utils.getIcon()
    });
}

exports.main = function(options, callbacks) {

    // Check if libnofify / OSX library is present
    if(notifApi.checkAvailable()) {
        //console.log("notifApi.checkAvailable is ok");
        if (system.platform != "darwin") {

            // Replace alert-service
            var contract = "@mozilla.org/alerts-service;1";
            let registrar = Cm.QueryInterface(Ci.nsIComponentRegistrar);

            // Unregister built-in alerts-service class factory
            registrar.unregisterFactory(
                Cc[contract],
                Cm.getClassObject(Cc[contract], Ci.nsIFactory)
            );

            // Register new factory
            registrar.registerFactory(
                Cc[contract],
                "GNotifier Alerts Service",
                contract,
                XPCOMUtils.generateSingletonFactory(AlertsService)
            );

            loaded = true;
        }
    }

    // Works only in FF<26 and SeaMonkey
    try {
        var dm = Cc["@mozilla.org/download-manager;1"].getService(Ci.nsIDownloadManager);
        dm.addListener(downloadProgressListener);
    } catch(e) {}
    try {
        var ps = require('sdk/preferences/service');
        if (loaded && sps['downloadCompleteAlert'])
        ps.set("browser.download.manager.showAlertOnComplete", false);
        else
        ps.set("browser.download.manager.showAlertOnComplete", true);
    } catch(e) {}

    // Thunderbird init
    //console.log("system.name:",system.name);
    if (loaded && (system.name == "Thunderbird" || system.name == "SeaMonkey" || system.name == "Icedove")) {
        var thunderbird = require('./thunderbird.js');
        thunderbird.init();
    } else {
        require("sdk/simple-prefs").on("test", function() {
          testNotification();
        });
    }

};

exports.onUnload = function (reason) {

    deleteTempFiles();

    // Unregister current alerts-service class factory
    var contract = "@mozilla.org/alerts-service;1";
    let registrar = Cm.QueryInterface(Ci.nsIComponentRegistrar);
    registrar.unregisterFactory(
        Cc[contract],
        Cm.getClassObject(Cc[contract], Ci.nsIFactory)
    );

    loaded = false;

    // Register orig alert service factory
    registrar.registerFactory(
        Cc[contract],
        "Orig Alerts Service",
        contract,
        origAlertsServiceFactory
    );

    // Works only in FF<26
    try {
        var ps = require('sdk/preferences/service');
        ps.set("browser.download.manager.showAlertOnComplete", true);
    } catch(e) {}

    // Thunderbird deinit
    if (system.name == "Thunderbird" || system.name == "SeaMonkey" || system.name == "Icedove") {
        var thunderbird = require('./thunderbird.js');
        thunderbird.deInit();
    }
}
