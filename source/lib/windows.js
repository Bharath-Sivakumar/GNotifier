// windows
var system = require("sdk/system");

var { Cc, Ci, Cu, Cm, Cr } = require('chrome');
Cu.import("resource://gre/modules/ctypes.jsm");
Cu.import("resource://gre/modules/FileUtils.jsm");

var dllName;
var callbackFunArray = [];
var winToast = null;

if (ctypes.voidptr_t.size == 4) {
    dllName = "ToastNotification.dll";
} else{
    dllName = "ToastNotification64.dll";
}

exports.init = function()
{
  if (winToast) {
      winToast.close();
      winToast = null;
  }
  try {
    winToast = ctypes.open(FileUtils.getFile("ProfD",
    ["extensions", "jid1-OoNOA6XBjznvLQ@jetpack", "resources", "gnotifier", "data", dllName]).path);
  } catch (e) {
    console.log(e);
  }

  if (!winToast) {
      console.log("Unable to load " + dllName);
      return false;
  }

  var setAppId = winToast.declare("SetAppId", ctypes.winapi_abi, ctypes.bool);
  return setAppId();
}

exports.deInit = function() {
    if (winToast)
        winToast.close();
}

// Do a real notification
exports.notify = function(iconURL, title, text, notifier, closeHandler, clickHandler){
    try{
        const clickCallbackType = ctypes.FunctionType(ctypes.stdcall_abi, ctypes.void_t).ptr;
        const closeCallbackType = ctypes.FunctionType(ctypes.stdcall_abi, ctypes.void_t).ptr;
        var DisplayToastNotification = winToast.declare("DisplayToastNotification",
            ctypes.winapi_abi,
            ctypes.bool,
            ctypes.jschar.ptr,
            ctypes.jschar.ptr,
            ctypes.jschar.ptr,
            ctypes.jschar.ptr,
            clickCallbackType,
            closeCallbackType);

        var closeCallback = null;
        if (closeHandler && typeof(closeHandler)==="function") {
            closeCallback = closeCallbackType(function(){
                closeHandler();
            });
            callbackFunArray.push(closeCallback);
        }

        var clickCallback = null;
        if (clickHandler && typeof(clickHandler)==="function") {
            clickCallback = clickCallbackType(function(){
                clickHandler();
            });
            callbackFunArray.push(clickCallback);
        }

        return DisplayToastNotification(iconURL, title, text, notifier, clickCallback, closeCallback);

    } catch (e){
      console.log(e);
      return false;
    }
}
