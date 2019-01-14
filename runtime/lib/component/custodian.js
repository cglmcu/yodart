var logger = require('logger')('custodian')
var inherits = require('util').inherits
var EventEmitter = require('events').EventEmitter
var property = require('@yoda/property')
var wifi = require('@yoda/wifi')
var network = require('@yoda/network')
var bluetooth = require('@yoda/bluetooth')
var CloudStore = require('../cloudapi')
var childProcess = require('child_process')
var _ = require('@yoda/util')._
var env = require('@yoda/env')()
var perf = require('../performance')

perf.stub('init')

module.exports = Custodian

function Custodian (runtime) {
  EventEmitter.call(this)
  this.runtime = runtime
  this.component = runtime.component

  this._networkInitialized = false
  this._network = null
  this._initNetwork()

  this._bluetoothStream = null
  this._bleTimeout = null
  this._initBluetooth()

  this.isLoggedIn = false
  this.cloudApi = new CloudStore({
    notify: this.onCloudEvent.bind(this)
  })
}
inherits(Custodian, EventEmitter)

Custodian.prototype._initNetwork = function () {
  this._network = new network()

  this._network.on('network.status', function (arg1, arg2) {
    if (!this._networkInitialized && arg1 === 'network' &&
        arg2.state === "CONNECTED") {
      logger.debug('network has connected.')

      this._networkInitialized = true
      property.set('state.network.connected', 'true')

      if (this.component.scheduler) {
        var appMap = this.component.scheduler.appMap
        Object.keys(appMap).forEach(key => {
          var activity = appMap[key]
          activity.emit('internal:network-connected')
        })
      }
    }

    if (this._networkInitialized && arg1 === 'network' &&
        arg2.state === "DISCONNECTED") {
      logger.debug('network has disconnected.')

      this._networkInitialized = false
      property.set('state.network.connected', 'false')

      this.runtime.resetNetwork()
    }
  }.bind(this))
}

Custodian.prototype._initBluetooth = function () {
  this._bluetoothStream = bluetooth.getMessageStream()

  this._bluetoothStream.on('handshaked', () => {
    logger.debug('ble device connected')
    this.component.light.appSound('@yoda', 'system://ble_connected.ogg')
  }.bind(this))

  this._bluetoothStream.on('disconnected', () => {
    logger.debug('ble device disconnected')
  }.bind(this))

  this._bluetoothStream.on('data', function (message) {
    logger.debug(message)

    if (message.topic === 'getWifiList') {
      this._network.wifiScanList().then((reply) => {
        var msg = JSON.parse(reply.msg[0])

        var wifiList = msg.wifilist.map((item) => {
          return {
            S: item.SSID,
            L: item.SIGNAL
          }
        })

        logger.debug('send WIFI List to App: ', JSON.stringify(wifiList))
        this._bluetoothStream.write({topic: 'getWifiList', data: wifiList})
      })
    } else if (message.topic === 'bind') {
      this._network.wifiOpen(message.data.S, message.data.P).then((reply) => {
        property.set('state.network.connected', 'true')
        this.component.light.appSound('@yoda', 'system://prepare_connect_wifi.ogg')

        this._bluetoothStream.write({
          topic: 'bind',
          sCode: '11',
          sMsg: 'wifi连接成功'
        })

        // start login flow
        logger.info(`connecting masterId=${message.data.U} is set`)
        this.login({ masterId: message.data.U })
      }, (err) => {
        property.set('state.network.connected', 'false')
        this.component.light.appSound('@yoda', 'system://wifi/connect_timeout.ogg')

        this._bluetoothStream.write({
          topic: 'bind',
          sCode: '-12',
          sMsg: 'wifi连接超时'
        })
      })
    }
  }.bind(this))
}

Custodian.prototype.startLogin = function () {
  if (this._network.networkStatus.state === "DISCONNECTED") {
    this._network.wifiStartScan()
    this.openBluetooth()
  } else {
    this.runtime.dispatchNotification('on-network-connected', [])
    this.login()
  }
}

/**
 * @private
 * @param {object} [options] - the options to login.
 * @param {string} [options.masterId] - the masterId to bind
 */
Custodian.prototype.login = _.singleton(function (options) {
  var masterId = _.get(options, 'masterId')
  var future = Promise.resolve()

  return future.then(() => {
    logger.info(`recconecting with -> ${masterId}`)
    // check if logged in and not for reconfiguring network,
    // just reconnect in background.
    if (!masterId && this.isLoggedIn) {
      logger.info('no login process is required, just skip and wait for awaking')
      return
    }

    // login -> mqtt
    property.set('state.rokid.logged', 'false')
    this.component.wormhole.setOffline()

    return this.cloudApi.connect(masterId).then((config) => {
      // TODO: move to use cloudapi?
      require('@yoda/ota/network').cloudgw = this.cloudApi.cloudgw
      // FIXME: schedule this update later?
      this.cloudApi.updateBasicInfo().catch((err) => {
        logger.error('Unexpected error on updating basic info', err.stack)
      })

      var opts = Object.assign({ uri: env.speechUri }, config)
      this.component.flora.updateSpeechPrepareOptions(opts)

      // overwrite `onGetPropAll`.
      this.runtime.onGetPropAll = function onGetPropAll () {
        return Object.assign({}, config)
      }
      this.component.wormhole.setClient(this.cloudApi.mqttcli)
      var customConfig = _.get(config, 'extraInfo.custom_config')
      if (customConfig && typeof customConfig === 'string') {
        this.component.customConfig.onLoadCustomConfig(customConfig)
      }
      this.component.dndMode.recheck()
    }, (err) => {
      if (err && err.code === 'BIND_MASTER_REQUIRED') {
        logger.error('bind master is required, just clear the local and enter network')
        this.runtime.resetNetwork()
      } else {
        logger.error('initializing occurs error', err && err.stack)
      }
    })
  })
})

/**
 * @private
 */
Custodian.prototype.onLoginSuccess = function () {
  property.set('state.rokid.logged', 'true')
  this.isLoggedIn = true

  var deferred = () => {
    perf.stub('started')

    this.component.dispatcher.delegate('runtimeDidLogin').then((delegation) => {
      if (delegation) {
        return
      }
      logger.info('announcing welcome')
      this.runtime.setMicMute(false, { silent: true }).then(() => {
        this.component.light.appSound('@yoda', 'system://startup0.ogg')
        return this.component.light.play('@yoda', 'system://setWelcome.js')
      }).then(() => {
        // not need to play startup music after relogin
        this.component.light.stop('@yoda', 'system://boot.js')
      })
    })

    var config = JSON.stringify(this.runtime.onGetPropAll())
    return this.runtime.ttsMethod('connect', [config]).then((res) => {
      if (!res) {
        logger.log('send CONFIG to ttsd ignore: ttsd service may not start')
      } else {
        logger.log(`send CONFIG to ttsd: ${res && res[0]}`)
      }
    }).catch((error) => {
      logger.log('send CONFIG to ttsd failed: call method failed', error)
    })
  }

  var sendReady = () => {
    var ids = Object.keys(this.component.appScheduler.appMap)
    return Promise.all(ids.map(it => this.component.lifetime.onLifeCycle(it, 'ready')))
  }

  var onDone = () => {
    this.runtime.dispatchNotification('on-ready', [])
  }

  return Promise.all([
    sendReady() /** only send ready to currently alive apps */,
    this.runtime.startDaemonApps(),
    this.setStartupFlag(),
    this.runtime.initiate()
  ]).then(deferred, err => {
    logger.error('Unexpected error on bootstrap', err.stack)
    return deferred()
  }).then(onDone, err => {
    logger.error('Unexpected error on logged in', err.stack)
    return onDone()
  })
}

/**
 * @private
 */
Custodian.prototype.onLoginFailed = function () {
  property.set('state.rokid.logged', 'false')
  this.isLoggedIn = false

  this.runtime.resetNetwork()
}

/**
 * Handle cloud events.
 * @private
 * 100: logging
 * 101: login success
 * 201: bind success
 * -101 login failed
 * -202 bind failed
 */
Custodian.prototype.onCloudEvent = function (code, msg) {
  code = parseInt(code)
  logger.debug(`cloud event code=${code} msg=${msg}`)

  if (code === 100) {
    logger.info('logging ...')
    return
  } else if (code === 101) {
    logger.info('login success')
    return
  } else if (code === 201) {
    logger.info('bind master success')
    this.onLoginSuccess()
  } else if (code === -101) {
    logger.info('login failed')
    this.component.light.appSound("@yada", "system://wifi/login_failed.ogg")
    this.onLoginFailed()
  } else if (code === -202) {
    logger.info('bind master failed')
    this.component.light.appSound("@yoda", "system://wifi/bind_master_failed.ogg")
    this.onLoginFailed()
  }

  this._network.wifiStopScan()
  this._bluetoothStream.write({ topic: 'bind', sCode: code, sMsg: msg })
  clearTimeout(this._bleTimeout)
  setTimeout(() => this._bluetoothStream.end(), 2000)
}

/**
 * Reset network and start procedure of configuring network.
 *
 * @param {object} [options] -
 * @param {boolean} [options.removeAll] - remove local wifi config?
 */
Custodian.prototype.openBluetooth = function () {
  var uuid = (property.get('ro.boot.serialno') || '').substr(-6)
  var productName = property.get('ro.rokid.build.productname') || 'Rokid-Me'
  var BLE_NAME = [ productName, uuid ].join('-')

  clearTimeout(this._clearTimeout)
  this._bleTimeout = setTimeout(() => this._bluetoothStream.end(), 120 * 1000)
  this._bluetoothStream.start(BLE_NAME, (err) => {
    if (err) {
      logger.error(err && err.stack)
      logger.info('open ble failed, name', BLE_NAME)
    } else {
      logger.info('open ble success, name', BLE_NAME)
      this.component.light.appSound('@yoda', 'system://wifi/setup_network.ogg')
      this.component.light.play('@yoda', 'system://setStandby.js', {}, { shouldResume: true })
    }
    // FIXME(Yorkie): needs tell bind is unavailable?
  })
}

// MARK: - Interception
Custodian.prototype.turenDidWakeUp = function () {
  if (this.isLoggedIn)
    return

  logger.warn('Network not connected, preparing to announce unavailability.')
  this.component.turen.pickup(false)

  /**
   * if runtime is logging in or network is unavailable,
   * and there is WiFi history existing,
   * announce WiFi is connecting.
   */
  logger.info('announcing network connecting on voice coming.')
  return this.component.light.ttsSound('@yoda', 'system://wifi_is_connecting.ogg')
    .then(() =>
      /** awaken is not set for no network available, recover media directly */
      this.component.turen.recoverPausedOnAwaken()
    )
}
// MARK: - END Interception

/**
 * Set a flag which informs startup service that it is time to boot other services.
 */
Custodian.prototype.setStartupFlag = function () {
  return new Promise((resolve, reject) => {
    /**
     * intended typo: bootts
     */
    childProcess.exec('touch /tmp/.com.rokid.activation.bootts', err => {
      if (err) {
        return reject(err)
      }
      resolve()
    })
  })
}

/**
 * Determines if startup flag has been set.
 * WARNING: This is a synchronous function.
 *
 * @returns {boolean}
 */
Custodian.prototype.isStartupFlagExists = function () {
  return fs.existsSync('/tmp/.com.rokid.activation.bootts')
}
