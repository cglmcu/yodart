var logger = require('logger')('custodian')
var property = require('@yoda/property')
var Network = require('@yoda/network').Network
var bluetooth = require('@yoda/bluetooth')

module.exports = Custodian

function Custodian (runtime) {
  this.runtime = runtime
  this.component = runtime.component
  this._masterId = null

  this._network = new Network(this.component.flora)
  this._networkStatus = {state: 'DISCONNECTED'}
  this._initNetwork()

  this._bluetoothStream = bluetooth.getMessageStream()
  this._bleTimer = null
  this._initBluetooth()
}

Custodian.prototype._initNetwork = function () {
  this._network.on('network.status', function (arg1, arg2) {
    if (arg1 !== 'network') { return }

    this._networkStatus = arg2
    if (this._networkStatus.state === 'CONNECTED') {
      property.set('state.network.connected', 'true')

      /*
       * Start login when received message that network has connected
       */
      if (!this.component.auth.isLoggedIn && !this.component.auth.isLogging) {
        logger.info(`connecting masterId=${this._masterId} is set`)
        if (this._masterId) {
          this.component.auth.login({ masterId: this._masterId })
        } else {
          this.component.auth.login()
        }
      }
    } else {
      property.set('state.network.connected', 'false')
    }
  }.bind(this))

  this._network.init()
  this._network.triggerStatus()
}

Custodian.prototype.isNetworkConnected = function () {
  return this._networkStatus.state === 'CONNECTED'
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
      this.runtime.dispatchNotification('on-network-connected', [])
      this._network.wifiOpen(message.data.S, message.data.P).then((reply) => {
        property.set('persist.netmanager.wifi', 1)
        property.set('persist.netmanager.wifi_ap', 0)
        this.component.light.appSound(
          '@yoda', 'system://prepare_connect_wifi.ogg')
        this._bluetoothStream.write(
          {topic: 'bind', sCode: '11', sMsg: 'wifi连接成功'})

        /**
         * reset isLoggedIn and networkStatus to trigger login
         */
        this._masterId = message.data.U
        this.component.auth.isLoggedIn = false
        this._networkStatus.state = 'DISCONNECTED'
      }, (err) => {
        property.set('persist.netmanager.wifi', 0)
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
