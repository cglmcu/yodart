var logger = require('logger')('custodian')
var property = require('@yoda/property')
var Network = require('@yoda/network').Network
var Ping = require('@yoda/network').Ping
var bluetooth = require('@yoda/bluetooth')

module.exports = Custodian

function Custodian (runtime) {
  this.runtime = runtime
  this.component = runtime.component

  this._network = new Network(this.component.flora)
  this._ping = new Ping('device-account.rokid.com')
  this._pingStatus = {state: 'DISCONNECTED'}
  this._pingInterval = 5000
  this._initPing()

  this._bluetoothStream = bluetooth.getMessageStream()
  this._bleTimer = null
  this._initBluetooth()
}

Custodian.prototype._initPing = function () {
  this._ping.on('ping.status', function (arg1, arg2) {
    this._pingStatus = arg2
    if (this._pingStatus.state === 'CONNECTED') {
      property.set('state.network.connected', 'true')
    } else {
      property.set('state.network.connected', 'false')
    }
  }.bind(this))

  this._ping.start(this._pingInterval)
}

Custodian.prototype._initBluetooth = function () {
  this._bluetoothStream.on('handshaked', () => {
    logger.debug('ble device connected')
    this.component.light.appSound('@yoda', 'system://ble_connected.ogg')
  }.bind(this))

  this._bluetoothStream.on('disconnected', () => {
    logger.debug('ble device disconnected')
  }.bind(this))

  this._bluetoothStream.on('data', function (message) {
    logger.debug(message)

    var authLogin = () => {
      logger.info(`connecting masterId=${message.data.U} is set`)
      var loginWaitSecond = 0
      var fn_login = function () {
        if (loginWaitSecond > this._pingInterval ||
            this._pingStatus.state === 'CONNECTED') {
          this.component.auth.login({ masterId: message.data.U })
        } else {
          loginWaitSecond += 1000
          setTimeout(fn_login, 1000)
        }
      }.bind(this)
      setTimeout(fn_login, 1000)
    }

    if (message.topic === 'getCapacities') {
      this._network.capacities().then((reply) => {
        var msg = JSON.parse(reply.msg[0])
        this._bluetoothStream.write({topic: 'getCapacities', data: msg})
      })

    } else if (message.topic === 'getWifiList') {
      this._network.wifiScanList().then((reply) => {
        var msg = JSON.parse(reply.msg[0])

        var wifiList = msg.wifilist.map((item) => {
          return {S: item.SSID, L: item.SIGNAL}
        })

        this._bluetoothStream.write({topic: 'getWifiList', data: wifiList})
      })

    } else if (message.topic === 'bind') {
      this._network.wifiOpen(message.data.S, message.data.P).then((reply) => {
        property.set('persist.netmanager.wifi', 'true')
        this.component.light.appSound(
          '@yoda', 'system://prepare_connect_wifi.ogg')
        this._bluetoothStream.write(
          {topic: 'bind', sCode: '11', sMsg: 'wifi连接成功'})

        authLogin()
      }, (err) => {
        property.set('persist.netmanager.wifi', 'false')
        this.component.light.appSound(
          '@yoda', 'system://wifi/connect_timeout.ogg')
        this._bluetoothStream.write(
          {topic: 'bind', sCode: '-12', sMsg: 'wifi连接超时'})
      })

    } else if (message.topic === 'bindModem') {
      this._network.modemOpen().then((reply) => {
        property.set('persist.netmanager.modem', 'true')
        // FIXME: play modem/connect_failed.ogg instead
        this.component.light.appSound(
          '@yoda', 'system://prepare_connect_wifi.ogg')
        this._bluetoothStream.write(
          {topic: 'bindModem', sCode: '11', sMsg: 'modem连接成功'})

        if (!this.component.auth.isLoggedIn) {
          authLogin()
        }
      }, (err) => {
        property.set('persist.netmanager.modem', 'false')
        // FIXME: play modem/connect_failed.ogg instead
        this.component.light.appSound(
          '@yoda', 'system://wifi/connect_timeout.ogg')
        this._bluetoothStream.write(
          {topic: 'bindModem', sCode: '-12', sMsg: 'modem连接失败'})
      })
    }
  }.bind(this))
}

Custodian.prototype.openBluetooth = function () {
  var uuid = (property.get('ro.boot.serialno') || '').substr(-6)
  var productName = property.get('ro.rokid.build.productname') || 'Rokid-Me'
  var BLE_NAME = [ productName, uuid ].join('-')

  clearTimeout(this._clearTimeout)
  this._bleTimer = setTimeout(() => {
    this.component.light.stop('@yoda', 'system://setStandby.js')
    this._bluetoothStream.end()
  }, 180 * 1000)

  this._bluetoothStream.start(BLE_NAME, (err) => {
    if (err) {
      logger.error(err && err.stack)
      logger.info('open ble failed, name', BLE_NAME)
    } else {
      logger.info('open ble success, name', BLE_NAME)
      this.component.light.appSound('@yoda', 'system://wifi/setup_network.ogg')
      this.component.light.play(
        '@yoda', 'system://setStandby.js', {}, { shouldResume: true })
    }
    // FIXME(Yorkie): needs tell bind is unavailable?
  })
}

Custodian.prototype.closeBluetooth = function (msg) {
  this._bluetoothStream.write(msg)
  this.component.light.stop('@yoda', 'system://setStandby.js')
  clearTimeout(this._bleTimer)
  setTimeout(() => this._bluetoothStream.end(), 2000)
}

// MARK: - Interception
Custodian.prototype.turenDidWakeUp = function () {
  if (this.component.auth.isLoggedIn) { return }

  logger.warn('Network not connected, preparing to announce unavailability.')
  this.component.turen.pickup(false)

  /**
   * if runtime is logging in or network is unavailable,
   * and there is WiFi history existing,
   * announce WiFi is connecting.
   */
  logger.info('announcing network connecting on voice coming.')
  return this.component.light.ttsSound(
    '@yoda', 'system://wifi_is_connecting.ogg'
  ).then(() =>
    /** awaken is not set for no network available, recover media directly */
    this.component.turen.recoverPausedOnAwaken()
  )
}
// MARK: - END Interception
