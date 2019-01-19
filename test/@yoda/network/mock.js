'use strict'

var assert = require('assert')

module.exports = mock

function mock () {
  this.networkStatus = {state: 'DISCONNECT'}
  this.wifiStatus = {state: 'DISCONNECT'}
}

mock.prototype._handleWifiCommand = function (msg) {
  switch (msg.command) {
    case 'GET_STATUS':
      var result = {
        wifi: this.wifiStatus,
        result: 'OK'
      }
      return { retCode: 0, msg: [JSON.stringify(result)] }

    case 'CONNECT':
      this.wifiStatus = {state: 'CONNECTED'}
      this.networkStatus = {state: 'CONNECTED'}
      return { retCode: 0, msg: [JSON.stringify({result: 'OK'})] }

    case 'DISCONNECT':
      this.wifiStatus = {state: 'DISCONNECTED'}
      this.networkStatus = {state: 'DISCONNECTED'}
      return { retCode: 0, msg: [JSON.stringify({result: 'OK'})] }

    case 'START_SCAN':
    case 'STOP_SCAN':
      return { retCode: 0, msg: [JSON.stringify({result: 'OK'})] }

    case 'GET_WIFILIST':
      var result = {
        wifilist: [
          {ssid: 'test', signal: -50},
          {ssid: 'guest', signal: -50}
        ],
        result: 'OK'
      }
      return { retCode: 0, msg: [JSON.stringify(result)] }
  }
}

mock.prototype.call = function (command, caps) {
  assert.strictEqual(command, 'network.command')
  var msg = JSON.parse(caps[0])
  var result = null

  if (msg.device === 'WIFI') {
    result = this._handleWifiCommand(msg)
  }

  return new Promise (function (resolve, reject) {
    resolve(result)
  })
}

mock.prototype.subscribe = function (command, callback) {
  assert.strictEqual(command, 'network.status')

  setTimeout(() => {
    callback([JSON.stringify({network: this.networkStatus})])
    callback([JSON.stringify({wifi: this.wifiStatus})])
  }, 500)
}
