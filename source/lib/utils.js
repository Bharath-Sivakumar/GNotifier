/**
 * GNotifier - Firefox/Thunderbird add-on that replaces
 * built-in notifications with the OS native notifications
 *
 * Copyright 2014 by Michal Kosciesza <michal@mkiol.net>
 *
 * Licensed under GNU General Public License 3.0 or later.
 * Some rights reserved. See COPYING, AUTHORS.
 *
 * @license GPL-3.0 <https://www.gnu.org/licenses/gpl-3.0.html>
 */

var { Cc, Ci, Cu, Cm, Cr } = require("chrome");
var _ = require("sdk/l10n").get;
var system = require("sdk/system");
//var Application = Cc["@mozilla.org/steel/application;1"].getService(Ci.steelIApplication);

exports.openFile = function (path) {
  //console.log("openFile path: " + path);
  var ioService = Cc["@mozilla.org/network/io-service;1"].getService(Ci.nsIIOService);
  var uri = ioService.newURI("file://"+path, null, null);
  if (uri instanceof Ci.nsIFileURL) {
    uri.file.QueryInterface(Ci.nsILocalFile).launch();
  }
}

exports.openDir = function (path) {
  //console.log("openDir path: " + path);
  if (system.platform === "winnt") {
    // Executing Explorer with file selection
    var wu = require("./windowsUtils.js");
    wu.openExplorer(path);
  } else {
    exports.openFile(path.replace(/[^\\\/]*$/, ''));
  }
}

// Gets icon for notification based on "system.name" or "notifyIcon" param
exports.getIcon = function () {
    // Windows already attaches the program icon to notifications
    if (system.platform === "winnt")
        return "";

    var sps = require("sdk/simple-prefs").prefs;
    var picon = sps["notifyIcon"];
    if (picon == "default") {
        if (system.name === "Firefox")
            return "firefox";
        if (system.name === "Thunderbird")
            return "thunderbird";
	if (system.name === "Iceweasel")
            return "iceweasel";
        if (system.name === "SeaMonkey")
            return "seamonkey";
        if (system.name === "Pale Moon")
            return "palemoon";
	if (system.name === "Icedove")
	  return "icedove";

        // default Firefox icon
        return "firefox";
    }
    return picon;
}

exports.isUrlValid = function (s) {

  // Source: http://dzone.com/snippets/validate-url-regexp

  var re = /(http|https|file):\/\/(\w+:{0,1}\w*@)?(\S+)(:[0-9]+)?(\/|\/([\w#!:.?+=&%@!\-\/]))?/;
  return re.test(s);
}

exports.sanitize = function(s) {

    // Source: https://developer.mozilla.org/en-US/Add-ons/Overlay_Extensions/XUL_School/DOM_Building_and_HTML_Insertion#Safely_Using_Remote_HTML

    var parser = Cc["@mozilla.org/parserutils;1"].getService(Ci.nsIParserUtils);
    s = parser.sanitize(s, parser.SanitizerCidEmbedsOnly);
    var re = /<body\s*[^>]*>([\S\s]*?)<\/body>/i;
    var match = re.exec(s);

    return match[1];

}

exports.getFileExtension = function(filename) {

  // Source: http://stackoverflow.com/a/1203361

  var a = filename.split(".");
  if (a.length === 1 || ( a[0] === "" && a.length === 2 ) ) {
    return "";
  }
  return a.pop();
}

exports.execute = function(command) {
  var child_process = require("sdk/system/child_process");
  var { env } = require('sdk/system/environment');
  var c;
  if (system.platform === "winnt") {
    var c_env = {env: {
      'ALLUSERSPROFILE':env.ALLUSERSPROFILE,
      'APPDATA':env.APPDATA,
      'CommonProgramFiles':env.CommonProgramFiles,
      'CommonProgramW6432':env.CommonProgramW6432,
      'COMPUTERNAME':env.COMPUTERNAME,
      'ComSpec':env.ComSpec,
      'FPS_BROWSER_APP_PROFILE_STRING':env.FPS_BROWSER_APP_PROFILE_STRING,
      'FPS_BROWSER_USER_PROFILE_STRING':env.FPS_BROWSER_USER_PROFILE_STRING,
      'HOMEDRIVE':env.HOMEDRIVE,
      'HOMEPATH':env.HOMEPATH,
      'LOCALAPPDATA':env.LOCALAPPDATA,
      'LOGONSERVER':env.LOGONSERVER,
      'NUMBER_OF_PROCESSORS':env.NUMBER_OF_PROCESSORS,
      'OS':env.OS,
      'Path':env.Path,
      'PATHEXT':env.PATHEXT,
      'PROCESSOR_ARCHITECTURE':env.PROCESSOR_ARCHITECTURE,
      'PROCESSOR_IDENTIFIER':env.PROCESSOR_IDENTIFIER,
      'PROCESSOR_LEVEL':env.PROCESSOR_LEVEL,
      'PROCESSOR_REVISION':env.PROCESSOR_REVISION,
      'ProgramData':env.ProgramData,
      'ProgramFiles':env.ProgramFiles,
      'ProgramW6432':env.ProgramW6432,
      'PROMPT':'$P$G',
      'PSModulePath':env.PSModulePath,
      'PUBLIC':env.PUBLIC,
      'SESSIONNAME':env.SESSIONNAME,
      'SystemDrive':env.SystemDrive,
      'SystemRoot':env.SystemRoot,
      'TEMP':env.TEMP,
      'TMP':env.TMP,
      'USERDOMAIN':env.USERDOMAIN,
      'USERDOMAIN_ROAMINGPROFILE':env.USERDOMAIN_ROAMINGPROFILE,
      'USERNAME':env.USERNAME,
      'USERPROFILE':env.USERPROFILE,
      'windir':env.windir
    }};
  } else {
    var c_env = {env: {
      'USER':env.USER,
      'HOME':env.HOME,
      'ALSA_CONFIG_PATH':env.ALSA_CONFIG_PATH,
      'AUDIODRIVER':env.AUDIODRIVER,
      'DBUS_SESSION_BUS_ADDRESS':env.DBUS_SESSION_BUS_ADDRESS,
      'DISPLAY':env.DISPLAY,
      'PATH':env.PATH,
      'JAVA_BINDIR':env.JAVA_BINDIR,
      'JAVA_HOME':env.JAVA_HOME,
      'JAVA_ROOT':env.JAVA_ROOT,
      'JRE_HOME':env.JRE_HOME,
      'DESKTOP_SESSION':env.DESKTOP_SESSION
    }};
  }

  c = child_process.exec(command, c_env);

  c.stdout.on('data', function (data) {
    console.log('command stdout: ' + data);
  });

  c.stderr.on('data', function (data) {
    console.log('command stderr: ' + data);
  });
}
