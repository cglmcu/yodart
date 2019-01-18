'use strict'

/**
 * @module @yoda/network
 * @description Provides classes to manage network functions on the device.
 */

var EventEmitter = require('events').EventEmitter
var native = require('./network.node')

/**
 * Ping
 */

class Ping extends EventEmitter {
  constructor (address) {
    super()

    this._intervalFunc = null
    this._address = 'www.taobao.com'
    if (address) { this._address = address }
  }

  ping (address) {
    if (!address) { address = this._address }

    if (native.networkState(address) === 0) {
      return {state: 'CONNECTED'}
    } else {
      return {state: 'DISCONNECTED'}
    }
  }

  start (interval, address) {
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

  stop () {
    clearInterval(this._intervalFunc)
  }
}

module.exports.Ping = Ping

/**
 * Network
 */

class Network extends EventEmitter {
  constructor (flora) {
    super()

    this.networkStatus = {state: 'DISCONNECTED'}
    this.wifiStatus = {state: 'DISCONNECTED'}
    this.ethernetStatus = {state: 'DISCONNECTED'}
    this.modemStatus = {state: 'DISCONNECTED'}

    this._remoteCallTarget = 'net_manager'
    this._remoteCallCommand = 'network.command'
    this._remoteCallTimeout = 60 * 1000

    this._flora = flora
  }

  init () {
    this._flora.subscribe('network.status', (caps, type) => {
      var msg = JSON.parse(caps[0])

      if (msg.network) {
        this.networkStatus = msg.network
        this.emit('network.status', 'network', msg.network)
      } else if (msg.wifi) {
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

  _remoteCall (device, command, params) {
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

  triggerStatus () {
    return this._remoteCall('NETWORK', 'TRIGGER_STATUS')
  }

  capacities () {
    return this._remoteCall('NETWORK', 'GET_CAPACITY')
  }

  wifiOpen (ssid, passwd) {
    return this._remoteCall('WIFI', 'CONNECT', {'SSID': ssid, 'PASSWD': passwd})
  }

  wifiClose () {
    return this._remoteCall('WIFI', 'DISCONNECT')
  }

  wifiStartScan () {
    return this._remoteCall('WIFI', 'START_SCAN')
  }

  wifiStopScan () {
    return this._remoteCall('WIFI', 'STOP_SCAN')
  }

  wifiScanList () {
    return this._remoteCall('WIFI', 'GET_WIFILIST')
  }

  wifiApOpen (ssid, passwd, ip, timeout) {
    return this._remoteCall('WIFI_AP', 'CONNECT', {
      SSID: ssid,
      PASSWD: passwd,
      IP: ip,
      TIMEOUT: timeout
    })
  }

  wifiApClose () {
    return this._remoteCall('WIFI_AP', 'DISCONNECT')
  }

  modemOpen () {
    return this._remoteCall('MODEM', 'CONNECT')
  }

  modemClose () {
    return this._remoteCall('MODEM', 'DISCONNECT')
  }
}

module.exports.Network = Network
