var util = require('util');
var SSDPClient = require('node-ssdp').Client;
var request = require('request');
var xml2js = require('xml2js');
var url = require('url');
var express = require('express');
var bodyparser = require('body-parser');
var os = require('os');

var WemoClient = require('./client');

var Wemo = module.exports = function() {
  this._clients = {};
  this.listen();
};

Wemo.prototype.discover = function(cb) {
  var self = this;
  var handleResponse = function(msg, statusCode, rinfo) {
    request.get(msg.LOCATION, function(err, res, xml) {
      if (!err) {
        xml2js.parseString(xml, function(err, json) {
          if (!err) {
            var location = url.parse(msg.LOCATION);
            var device = {
              host: location.hostname,
              port: location.port,
              callbackURL: self.getCallbackURL()
            };
            for (var key in json.root.device[0]) {
              device[key] = json.root.device[0][key][0];
            }
            if (cb) {
              // Return only matching devices and return them only once!
              if (!self._clients[device.UDN] && device.deviceType.match(/^urn:Belkin:device/)) {
                cb.call(self, device);
              }
            }
          }
        });
      }
    });
  };

  var ssdpClient = new SSDPClient();
  ssdpClient.on('response', handleResponse);
  ssdpClient.search('urn:Belkin:service:basicevent:1');
};

Wemo.prototype.listen = function() {
  var self = this;
  var app = express();
  app.use(bodyparser.raw({type: 'text/xml'}));
  app.all('/:udn', function(req, res) {
    xml2js.parseString(req.body, function(err, json){
      if (err) {
        console.log(err);
        res.sendStatus(500);
      }
      if (!self._clients[req.params.udn]) {
        console.log('Received callback for unknown device: %s', req.params.udn);
        res.sendStatus(404);
      } else {
        self._clients[req.params.udn].handleCallback(json);
        res.sendStatus(200);
      }
    });
  });

  this._server = app.listen(0);
};

Wemo.prototype.getCallbackURL = function() {
  var getLocalInterfaceAddress = function() {
    var interfaces = os.networkInterfaces();
    var addresses = [];
    for (var k in interfaces) {
      for (var k2 in interfaces[k]) {
        var address = interfaces[k][k2];
        if (address.family === 'IPv4' && !address.internal) {
          addresses.push(address.address);
        }
      }
    }
    return addresses.shift();
  };

  if (!this._callbackURL) {
    var port = this._server.address().port;
    var host = getLocalInterfaceAddress();
    this._callbackURL = 'http://' + host + ':' + port;
  }
  return this._callbackURL;
};

Wemo.prototype.client = function(device) {
  if (this._clients[device.UDN]) {
    return this._clients[device.UDN];
  }

  var client = this._clients[device.UDN] = new WemoClient(device);
  return client;
};