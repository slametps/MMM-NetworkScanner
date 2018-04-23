/* global Log, Module, moment, config */
/* Magic Mirror
 * Module: MMM-NetworkScanner
 *
 * By Ian Perrin http://ianperrin.com
 * MIT Licensed.
 */

//var Module, Log, moment, config, Log, moment, document;


Module.register("MMM-NetworkScanner", {
   // Default module config.
  defaults: {
      devices: [],                    // an array of device objects e.g. { macAddress: "aa:bb:cc:11:22:33", name: "DEVICE-NAME", icon: "FONT-AWESOME-ICON"}
      showUnknown: true,              // shows devices found on the network even if not specified in the 'devices' option
      showOffline: true,              // shows devices specified in the 'devices' option even when offline
      showLastSeen: false,            // shows when the device was last seen e.g. "Device Name - last seen 5 minutes ago"
      keepAlive: 180,                 // how long (in seconds) a device should be considered 'alive' since it was last found on the network
      updateInterval: 20,             // how often (in seconds) the module should scan the network

      residents: [],
      occupiedCMD: null,              // {notification: 'TEST', payload: {action: 'occupiedCMD'}},
      vacantCMD: null,                // {notification: 'TEST', payload: {action: 'vacantCMD'}},

      debug: false,
  },

  // Subclass start method.
  start: function () {
      Log.info("Starting module: " + this.name);
      if (this.config.debug) Log.info(this.name + " config: ", this.config);

      // variable for if anyone is home
      this.occupied = true;

      moment.locale(config.language);

      this.validateDevices();

      this.sendSocketNotification('CONFIG', this.config);

      this.scanNetwork();
  },

  // Subclass getStyles method.
  getStyles: function () {
      return ['font-awesome.css'];
  },

  // Define required translations.
	getTranslations: function() {
    return {
      'en': 'translations/en.json',
      'id': 'translations/id.json'
    };
	},

  // Subclass getScripts method.
  getScripts: function () {
      return ["moment.js"];
  },

  getCommands: function(commander) {
    commander.add({
      command: 'netscan',
      description: this.translate("TXT_NETWORKSCANNER_DESC"),
      callback: 'cmd_netscan'
    })
  },

  cmd_netscan: function(command, handler) {
    var self = this;
    var text = "";
    text += "*" + this.translate("TXT_NETWORKSCANNER") + "*\n";

    this.networkDevices.forEach(function (device) {
      if (device) {
        // Name
        text += device.name;

        // When last seen
        if (self.config.showLastSeen && device.lastSeen) {
           text += " - " + device.lastSeen.fromNow();
        }

        text += "\n";
      }
    });

    handler.reply("TEXT", text, {parse_mode:'Markdown'});
  },

  // Subclass socketNotificationReceived method.
  socketNotificationReceived: function (notification, payload) {
      if (this.config.debug) Log.info(this.name + " received a notification: " + notification, payload);

      var self = this;

      if (notification === 'IP_ADDRESS') {
          if (payload.hasOwnProperty("ipAddress")) {
              // set last seen
              if (payload.online) {
                 payload.lastSeen = moment();
              }
              // Keep alive?
              payload.online = (moment().diff(payload.lastSeen, 'seconds') < this.config.keepAlive);
          }
      }

      if (notification === 'MAC_ADDRESSES') {
          if (this.config.debug) Log.info(this.name + " MAC_ADDRESSES payload: ", payload);

          this.networkDevices = payload;

          // Update device info
          for (var i = 0; i < this.networkDevices.length; i++) {
              var device = this.networkDevices[i];
              // Set last seen
              if (device.online) {
                  device.lastSeen = moment();
              }
              // Keep alive?
              device.online = (moment().diff(device.lastSeen, 'seconds') < this.config.keepAlive);
          }

          // Add offline devices from config
          if (this.config.showOffline) {
              for (var d = 0; d < this.config.devices.length; d++) {
                  var device = this.config.devices[d];

                  for(var n = 0; n < this.networkDevices.length; n++){
                      if( device.macAddress && this.networkDevices[n].macAddress && this.networkDevices[n].macAddress.toUpperCase() === device.macAddress.toUpperCase()) {
                          n = -1;
                          break;
                      }
                  }

                  if (n != -1) {
                      device.online = false;
                      this.networkDevices.push(device);
                  }
              }
          }

          // Sort list by known device names, then unknown device mac addresses
          this.networkDevices.sort(function (a, b) {
              var stringA, stringB;
              stringA = (a.type != "Unknown" ? "_" + a.name + a.macAddress : a.name);
              stringB = (b.type != "Unknown" ? "_" + b.name + b.macAddress : b.name);

              return stringA.localeCompare(stringB);
          });


          // Send notification if user status has changed
          if (this.config.residents.length > 0) {
              var anyoneHome, command;
//                self = this;
              anyoneHome = 0;

              this.networkDevices.forEach(function (device) {
                  if (self.config.residents.indexOf(device.name) >= 0) {
                      anyoneHome = anyoneHome + device.online;
                  }
              });

              if (this.config.debug) Log.info("# people home: ", anyoneHome);
              if (this.config.debug) Log.info("Was occupied? ", this.occupied);

              if (anyoneHome > 0) {
                  if (this.occupied === false) {
                      if (this.config.debug) Log.info("Someone has come home");
                      command = self.config.occupiedCMD;
                      this.sendNotification(command.notification, command.payload);
                      this.occupied = true;
                  }
              } else {
                  if (this.occupied === true) {
                      if (this.config.debug) Log.info("Everyone has left home");
                      command = self.config.vacantCMD;
                      this.sendNotification(command.notification, command.payload);
                      this.occupied = false;
                  }
              }
          }

          this.updateDom();
          return;

      }

  },

  // Override dom generator.
  getDom: function () {
      var wrapper, deviceList, icon, deviceItem, deviceOnline, self;
      wrapper = document.createElement("div");

      self = this;

      wrapper.classList.add("small");

      // Display a loading message
      if (!this.networkDevices) {
          wrapper.innerHTML = this.translate("LOADING");
          return wrapper;
      }

      // Display device status
      deviceList = document.createElement("ul");
      deviceList.classList.add("fa-ul");
      this.networkDevices.forEach(function (device) {
          if (device) {

              // device list item
              deviceItem = document.createElement("li");
              deviceOnline = (device.online ? "bright" : "dimmed");
              deviceItem.classList.add(deviceOnline);

              // Icon
              icon =  document.createElement("i");
              icon.classList.add("fa-li", "fa", "fa-" + device.icon);
              deviceItem.appendChild(icon);

              // Name
              deviceItem.innerHTML += device.name;

              // When last seen
              if (self.config.showLastSeen && device.lastSeen) {
                 deviceItem.innerHTML += "&nbsp;<small class=\"dimmed\">(" + device.lastSeen.fromNow() + ")</small>";
              }

              deviceList.appendChild(deviceItem);

          } else {
              if (this.config.debug) Log.info(self.name + " Online, but ignoring: '" + device + "'");
          }
      });
      if (deviceList.hasChildNodes()) {
          wrapper.appendChild(deviceList);
      } else {
          // Display no devices online message
          wrapper.innerHTML = this.translate("NO DEVICES ONLINE");
      }

      return wrapper;
  },

  validateDevices: function () {
      this.config.devices.forEach(function (device) {
          // Add missing device attributes.
          if (!device.hasOwnProperty("icon")) {
              device.icon = "question";
          }
          if (!device.hasOwnProperty("name")) {
              if (device.hasOwnProperty("macAddress")) {
                  device.name = device.macAddress;
              } else if (device.hasOwnProperty("ipAddress")) {
                  device.name = device.ipAddress;
              } else {
                  device.name = "Unknown";
              }
          }
      });
  },

  scanNetwork: function () {
      if (this.config.debug) Log.info(this.name + " is initiating network scan");
      var self = this;
      this.sendSocketNotification('SCAN_NETWORK');
      setInterval(function () {
          self.sendSocketNotification('SCAN_NETWORK');
      }, this.config.updateInterval * 1000);
      return;
  },

});

