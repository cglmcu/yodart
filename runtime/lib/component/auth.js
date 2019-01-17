var logger = require('logger')('auth')
var property = require('@yoda/property')
var CloudStore = require('../cloudapi')
var childProcess = require('child_process')
var fs = require('fs')
var _ = require('@yoda/util')._
var env = require('@yoda/env')()
var perf = require('../performance')

perf.stub('init')

module.exports = Auth

function Auth (runtime) {
  this.runtime = runtime
  this.component = runtime.component

  this.isLoggedIn = false
  this.cloudApi = new CloudStore({
    notify: this.onCloudEvent.bind(this)
  })
}

Auth.prototype.startLogin = function (force) {
  if (force || this.component.custodian._pingStatus.state === 'DISCONNECTED') {
    this.component.custodian._network.wifiStartScan()
    this.component.custodian.openBluetooth()
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
Auth.prototype.login = _.singleton(function (options) {
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
Auth.prototype.onLoginSuccess = function () {
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
Auth.prototype.onLoginFailed = function () {
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
Auth.prototype.onCloudEvent = function (code, msg) {
  logger.debug(`cloud event code=${code} msg=${msg}`)

  var _code = parseInt(code)
  if (_code === 100) {
    logger.info('logging ...')
    return
  } else if (_code === 101) {
    logger.info('login success')
    return
  } else if (_code === 201) {
    logger.info('bind master success')
    this.onLoginSuccess()
  } else if (_code === -101) {
    logger.info('login failed')
    this.component.light.appSound('@yada', 'system://wifi/login_failed.ogg')
    this.onLoginFailed()
  } else if (_code === -202) {
    logger.info('bind master failed')
    this.component.light.appSound('@yoda', 'system://wifi/bind_master_failed.ogg')
    this.onLoginFailed()
  }

  this.component.custodian._network.wifiStopScan()
  this.component.custodian.closeBluetooth({ topic: 'bind', sCode: code, sMsg: msg })
}

/**
 * Set a flag which informs startup service that it is time to boot other services.
 */
Auth.prototype.setStartupFlag = function () {
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
Auth.prototype.isStartupFlagExists = function () {
  return fs.existsSync('/tmp/.com.rokid.activation.bootts')
}
