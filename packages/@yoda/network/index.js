'use strict'

/**
 * @module @yoda/network
 * @description Provides classes to manage network functions on the device.
 */

var EventEmitter = require('events').EventEmitter
var inherits = require('util').inherits
var native = require('./network.node')

/**
 * Ping
 */

module.exports.Ping = Ping

function Ping (address) {
  EventEmitter.call(this)
  this._intervalFunc = null
  this._address = 'www.taobao.com'
  if (address) { this._address = address }
}
inherits(Ping, EventEmitter)

Ping.prototype.ping = function (address) {
  if (!address) { address = this._address }

  if (native.networkState(address) === 0) {
    return {state: 'CONNECTED'}
  } else {
    return {state: 'DISCONNECTED'}
  }
}

Ping.prototype.start = function (interval, address) {
  if (!address) { address = this._address }

  var fn = function () {
    if (native.networkState(address) === 0) {
      this.emit('ping.status', 'ping', {state: 'CONNECTED'})
    } else {
      this.emit('ping.status', 'ping', {state: 'DISCONNECTED'})
    }
  }.bind(this)

  fn()
  this._intervalFunc = setInterval(fn, interval)
}

Ping.prototype.stop = function () {
  clearInterval(this._intervalFunc)
}

/**
 * Network
 */

module.exports.Network = Network

function Network (flora) {
  EventEmitter.call(this)

  this.wifiStatus = {state: 'DISCONNECTED'}
  this.ethernetStatus = {state: 'DISCONNECTED'}
  this.modemStatus = {state: 'DISCONNECTED'}

  this._remoteCallTarget = 'net_manager'
  this._remoteCallCommand = 'network.command'
  this._remoteCallTimeout = 60 * 1000

  this._flora = flora
  this._initFlora()
}
inherits(Network, EventEmitter)

Network.prototype._initFlora = function () {
  this._flora.subscribe('network.status', (caps, type) => {
    var msg = JSON.parse(caps[0])

    if (msg.wifi) {
      this.wifiStatus = msg.wifi
      this.emit('network.status', 'wifi', msg.wifi)
    } else if (msg.ethernet) {
      this.ethernetStatus = msg.ethernet
      this.emit('network.status', 'ethernet', msg.ethernet)
    } else if (msg.modem) {
      this.modemStatus = msg.modem
      this.emit('network.status', 'modem', msg.modem)
    }
  })
}

Network.prototype._remoteCall = function (device, command, params) {
  var data = {
    device: device,
    command: command
  }
  if (params) { data.params = params }

  return this._flora.call(
    this._remoteCallCommand,
    [JSON.stringify(data)],
    this._remoteCallTarget,
    this._remoteCallTimeout
  )
}

Network.prototype.capacities = function () {
  return this._remoteCall('NETWORK', 'GET_CAPACITY')
}

Network.prototype.wifiOpen = function (ssid, passwd) {
  return this._remoteCall('WIFI', 'CONNECT', {'SSID': ssid, 'PASSWD': passwd})
}

Network.prototype.wifiClose = function () {
  return this._remoteCall('WIFI', 'DISCONNECT')
}

Network.prototype.wifiStartScan = function () {
  return this._remoteCall('WIFI', 'START_SCAN')
}

Network.prototype.wifiStopScan = function () {
  return this._remoteCall('WIFI', 'STOP_SCAN')
}

Network.prototype.wifiScanList = function () {
  return this._remoteCall('WIFI', 'GET_WIFILIST')
}

Network.prototype.wifiApOpen = function (ssid, passwd, ip, timeout) {
  return this._remoteCall('WIFI_AP', 'CONNECT', {
    SSID: ssid,
    PASSWD: passwd,
    IP: ip,
    TIMEOUT: timeout
  })
}

Network.prototype.wifiApClose = function () {
  return this._remoteCall('WIFI_AP', 'DISCONNECT')
}

Network.prototype.modemOpen = function () {
  return this._remoteCall('MODEM', 'CONNECT')
}

Network.prototype.modemClose = function () {
  return this._remoteCall('MODEM', 'DISCONNECT')
}
