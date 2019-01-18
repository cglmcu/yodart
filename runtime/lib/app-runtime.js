'use strict'

/**
 * @namespace yodaRT
 */

var EventEmitter = require('events').EventEmitter
var inherits = require('util').inherits
var Url = require('url')
var querystring = require('querystring')
var logger = require('logger')('yoda')
var ComponentConfig = require('/etc/yoda/component-config.json')
var _ = require('@yoda/util')._
var property = require('@yoda/property')
var system = require('@yoda/system')
var Loader = require('@yoda/bolero').Loader

module.exports = AppRuntime

/**
 * @memberof yodaRT
 * @class
 */
function AppRuntime () {
  EventEmitter.call(this)
  this.cloudSkillIdStack = []
  this.domain = {
    cut: '',
    scene: '',
    active: ''
  }

  this.componentLoader = new Loader(this, 'component')
  ComponentConfig.paths.forEach(it => {
    this.componentLoader.load(it)
  })

  this.inited = false
  this.hibernated = false
  // identify load app complete
  this.loadAppComplete = false
  this.shouldStopLongPressMicLight = false
}
inherits(AppRuntime, EventEmitter)

/**
 * Start AppRuntime
 *
 * @returns {Promise<void>}
 */
AppRuntime.prototype.init = function init () {
  if (this.inited) {
    return Promise.resolve()
  }
  this.componentsInvoke('init')
  /** set turen to not muted */
  this.component.turen.toggleMute(false)
  this.component.turen.toggleWakeUpEngine(true)

  this.component.lifetime.on('stack-reset', () => {
    this.resetCloudStack()
  })
  this.component.lifetime.on('preemption', appId => {
    this.appPause(appId)
  })
  // initializing the whole process...
  this.resetCloudStack()
  this.resetServices()

  return this.loadApps().then(() => {
    this.inited = true
    return this.component.dispatcher.delegate('runtimeDidInit')
  }).then(delegation => {
    if (delegation) {
      return
    }
    var future = Promise.resolve()
    if (property.get('sys.firstboot.init', 'persist') !== '1') {
      // initializing play tts status
      property.set('sys.firstboot.init', '1', 'persist')
      future = future.then(() => {
        return this.component.light.ttsSound('@system', 'system://firstboot.ogg')
      })
    }
    future.then(() => {
      this.component.light.appSound('@yoda', 'system://boot.ogg')
      this.component.light.play('@yoda', 'system://boot.js', { fps: 200 })
    })
    this.component.auth.startLogin()
  })
}

/**
 * Deinit runtime.
 */
AppRuntime.prototype.deinit = function deinit () {
  this.componentsInvoke('deinit')
}

/**
 * Invokes method on each component if exists with args.
 *
 * @param {string} method - method name to be invoked.
 * @param {any[]} args - arguments on invocation.
 */
AppRuntime.prototype.componentsInvoke = function componentsInvoke (method, args) {
  if (args == null) {
    args = []
  }
  Object.keys(this.componentLoader.registry).forEach(it => {
    var comp = this.component[it]
    var fn = comp[method]
    if (typeof fn === 'function') {
      fn.apply(comp, args)
    }
  })
}

/**
 * Load applications.
 */
AppRuntime.prototype.loadApps = function loadApps () {
  logger.info('start loading applications')
  return this.component.appLoader.reload()
    .then(() => {
      this.loadAppComplete = true
      logger.log('load app complete')
      return this.initiate()
    })
}

/**
 * Initiate/Re-initiate runtime configs
 */
AppRuntime.prototype.initiate = function initiate () {
  if (!this.loadAppComplete) {
    return Promise.reject(new Error('Apps not loaded yet, try again later.'))
  }
  this.component.sound.initVolume()
  return Promise.resolve()
}

/**
 * Start the daemon apps.
 */
AppRuntime.prototype.startDaemonApps = function startDaemonApps () {
  var self = this
  var daemons = Object.keys(self.component.appLoader.appManifests).map(appId => {
    var manifest = self.component.appLoader.appManifests[appId]
    if (!manifest.daemon) {
      return
    }
    return appId
  }).filter(it => it)

  return start(0)
  function start (idx) {
    if (idx > daemons.length - 1) {
      return Promise.resolve()
    }
    var appId = daemons[idx]
    logger.info('Starting daemon app', appId)
    return self.component.lifetime.createApp(appId)
      .then(() => {
        return start(idx + 1)
      }, () => {
        /** ignore error and continue populating */
        return start(idx + 1)
      })
  }
}

/**
 * Handle power button activation.
 * - if not connected to network yet, disable bluetooth broadcast.
 * - if there are apps actively running, terminates all apps.
 * - otherwise set device actively pickup.
 */
AppRuntime.prototype.handlePowerActivation = function handlePowerActivation () {
  var currentAppId = this.component.lifetime.getCurrentAppId()
  logger.info('handling power activation, current app is', currentAppId)

  /**
   * reset services whenever possible
   */
  var future = this.resetServices({ lightd: false })

  if (currentAppId == null && !this.component.auth.isLoggedIn) {
    // guide user to configure network but not start network app directly
    return future.then(() => this.component.light.ttsSound('@yoda', 'system://guide_config_network.ogg'))
  }

  future = Promise.all([ future, this.idle() ])

  if (currentAppId) {
    /**
     * if there is any app actively running, do not pick up.
     */
    return future
  }

  return future.then(() => {
    if (this.component.turen.pickingUp) {
      /**
       * already picking up, discard current pick session.
       */
      return this.setPickup(false)
    }
    return this.setPickup(true, 6000, true)
  })
}

/**
 * Put device into idle state. Terminates apps in stack (i.e. apps in active and paused).
 *
 * Also clears apps' contexts.
 */
AppRuntime.prototype.idle = function idle () {
  logger.info('set runtime to idling')
  /**
   * Clear apps and its contexts
   */
  this.resetCloudStack()
  return this.component.lifetime.deactivateAppsInStack()
}

/**
 * Put device into hibernation state.
 */
AppRuntime.prototype.hibernate = function hibernate () {
  if (this.hibernate !== false) {
    logger.info('runtime already hibernated, skipping')
    return Promise.resolve()
  }
  logger.info('hibernating runtime')
  this.hibernated = true
  /**
   * Clear apps and its contexts
   */
  this.resetCloudStack()
  return this.component.lifetime.destroyAll({ force: true })
}

AppRuntime.prototype.wakeup = function wakeup () {
  if (this.hibernate !== true) {
    logger.info('runtime already woken up, skipping')
    return Promise.resolve()
  }
  logger.info('waking up runtime')
  this.hibernated = false
  this.component.custodian.prepareNetwork()
  return this.startDaemonApps()
}

/**
 * play longPressMic.js if long press mic is bigger than 2 second.
 */
AppRuntime.prototype.playLongPressMic = function () {
  this.shouldStopLongPressMicLight = true
  if (this.component.sound.isMuted()) {
    this.component.sound.unmute()
  }

  // In order to play sound when currently is muted
  Promise.all([
    this.component.light.appSound('@yoda', 'system://key_config_notify.ogg'),
    this.component.light.play('@yoda', 'system://longPressMic.js')
  ]).catch((err) => {
    logger.error(`play longPress light or sound error: ${err.message}`)
  })
}

/**
 * Stop light if long press between 2 and 7 second.
 */
AppRuntime.prototype.stopLongPressMicLight = function stopLongPressMicLight () {
  if (this.shouldStopLongPressMicLight === true) {
    // stop longPress light and sound ahead of time
    Promise.all([
      this.component.light.stopSoundByAppId('@yoda'),
      this.component.light.stop('@yoda', '/opt/light/longPressMic.js')
    ]).then(() => {
      logger.log('stop longPress light or sound ahead of time')
    }).catch((err) => {
      logger.error(`An error occurend while stopping longPress the lighting or sound in advance: ${err.message}`)
    })
    this.shouldStopLongPressMicLight = false
  }
}

/**
 * Reset network and start procedure of configuring network.
 *
 * @param {object} [options] -
 * @param {boolean} [options.removeAll] - remove local wifi config?
 */
AppRuntime.prototype.resetNetwork = function () {
  /**
   * reset should welcome so that welcome effect could be played on re-login
   */
  this.shouldStopLongPressMicLight = false

  return Promise.all([
    this.component.lifetime.destroyAll(),
    this.setMicMute(false, { silent: true })
  ]).then(() => {
    this.component.auth.startLogin(true)
  }).then(() => {
    logger.debug('stop long press')
    this.component.light.stop('@yoda', '/opt/light/longPressMic.js')
  }, err => {
    logger.error('Unexpected error on resetting network', err.stack)
    this.component.light.stop('@yoda', '/opt/light/longPressMic.js')
  })
}

/**
 * Start a session of monologue. In session of monologue, no other apps could preempt top of stack.
 *
 * Note that monologues automatically ends on unexpected exit of apps.
 *
 * @param {string} appId
 */
AppRuntime.prototype.startMonologue = function (appId) {
  if (appId !== this.component.lifetime.getCurrentAppId()) {
    return Promise.reject(new Error(`App ${appId} is not currently on top of stack.`))
  }
  this.component.lifetime.monopolist = appId
  return Promise.resolve()
}

/**
 * Stop a session of monologue started previously.
 *
 * @param {string} appId
 */
AppRuntime.prototype.stopMonologue = function (appId) {
  if (this.component.lifetime.monopolist === appId) {
    this.component.lifetime.monopolist = null
  }
  return Promise.resolve()
}

/**
 * Resolving the NLP from service and execute the application lifetime.
 * @private
 * @param {string} asr
 * @param {object} nlp
 * @param {object} action
 * @param {object} [options]
 * @param {boolean} [options.preemptive]
 * @param {boolean} [options.carrierId]
 */
AppRuntime.prototype.onVoiceCommand = function (asr, nlp, action, options) {
  var preemptive = _.get(options, 'preemptive', true)
  var carrierId = _.get(options, 'carrierId')

  if (_.get(nlp, 'appId') == null) {
    logger.log('invalid nlp/action, ignore')
    return Promise.resolve(false)
  }
  var form = _.get(action, 'response.action.form')

  var appId
  if (nlp.cloud) {
    appId = '@yoda/cloudappclient'
  } else {
    appId = this.component.appLoader.getAppIdBySkillId(nlp.appId)
  }
  if (appId == null) {
    logger.warn(`Local app '${nlp.appId}' not found.`)
    if (nlp.appName) {
      return this.openUrl(`yoda-skill://rokid-exception/no-local-app?${querystring.stringify({
        appId: nlp.appId,
        appName: nlp.appName
      })}`)
    }
    /**
     * do nothing if no `appName` specified in malicious NLP to prevent frequent harassments.
     */
    return Promise.resolve(false)
  }

  if (this.component.lifetime.isMonopolized() && preemptive && appId !== this.component.lifetime.monopolist) {
    logger.warn(`LaVieEnPile has ben monopolized, skip voice command to app(${appId}).`)
    return this.component.lifetime.onLifeCycle(this.component.lifetime.monopolist, 'oppressing', 'request')
      .then(() => /** prevent tts/media from recovering */true)
  }

  return this.component.lifetime.createApp(appId)
    .catch(err => {
      logger.error(`create app ${appId} failed`, err.stack)
      /** force quit app on create error */
      return this.component.lifetime.destroyAppById(appId, { force: true })
        .then(() => { /** rethrow error to break following procedures */throw err })
    })
    .then(() => {
      if (!preemptive) {
        logger.info(`app is not preemptive, skip activating app ${appId}`)
        return
      }

      logger.info(`app is preemptive, activating app ${appId}`)
      return this.component.lifetime.activateAppById(appId, form, carrierId)
        .then(() => {
          this.updateCloudStack(nlp.appId, form)
          this.component.sound.unmuteIfNecessary(nlp.appId)
        })
    })
    .then(() => this.component.lifetime.onLifeCycle(appId, 'request', [ nlp, action ]))
    .then(() => true)
    .catch(err => {
      logger.error(`Unexpected error on app ${appId} handling voice command`, err.stack)
      return false
    })
}

/**
 *
 * > Note: currently only `yoda-skill:` scheme is supported.
 *
 * @param {string} url -
 * @param {object} [options] -
 * @param {'cut' | 'scene'} [options.form='cut'] -
 * @param {boolean} [options.preemptive=true] -
 * @param {string} [options.carrierId] -
 * @returns {Promise<boolean>}
 */
AppRuntime.prototype.openUrl = function (url, options) {
  var form = _.get(options, 'form', 'cut')
  var preemptive = _.get(options, 'preemptive', true)
  var carrierId = _.get(options, 'carrierId')

  var urlObj = Url.parse(url, true)
  if (urlObj.protocol !== 'yoda-skill:') {
    logger.info('Url protocol other than yoda-skill is not supported now.')
    return Promise.resolve(false)
  }
  var skillId = this.component.appLoader.getSkillIdByHost(urlObj.hostname)
  if (skillId == null) {
    logger.info(`No app registered for skill host '${urlObj.hostname}'.`)
    return Promise.resolve(false)
  }
  var appId = this.component.appLoader.getAppIdBySkillId(skillId)

  if (this.component.lifetime.isMonopolized() && preemptive && appId !== this.component.lifetime.monopolist) {
    logger.warn(`LaVieEnPile has ben monopolized, skip url request to app(${appId}).`)
    return this.component.lifetime.onLifeCycle(this.component.lifetime.monopolist, 'oppressing', 'url')
      .then(() => /** prevent tts/media from recovering */true)
  }

  return this.component.lifetime.createApp(appId)
    /** force quit app on create error */
    .catch(err => {
      logger.error(`create app ${appId} failed`, err.stack)
      return this.component.lifetime.destroyAppById(appId, { force: true })
        .then(() => { /** rethrow error to break following procedures */throw err })
    })
    .then(() => {
      if (!preemptive) {
        logger.info(`app is not preemptive, skip activating app ${appId}`)
        return Promise.resolve()
      }

      logger.info(`app is preemptive, activating app ${appId}`)
      return this.component.lifetime.activateAppById(appId, form, carrierId)
        .then(() => this.updateCloudStack(skillId, form))
    })
    .then(() => this.component.lifetime.onLifeCycle(appId, 'url', [ urlObj ]))
    .then(() => true)
    .catch(err => {
      logger.error(`open url(${url}) error with appId: ${appId}`, err.stack)
      return false
    })
}

/**
 * Dispatches a notification request to apps registered for the channel.
 *
 * @param {string} channel
 * @param {any[]} params
 * @param {object} [options]
 * @param {'active' | 'running' | 'all'} [options.filterOption='all']
 */
AppRuntime.prototype.dispatchNotification = function dispatchNotification (channel, params, options) {
  var filterOption = _.get(options, 'filterOption', 'all')
  var appIds = this.component.appLoader.notifications[channel]
  if (!Array.isArray(appIds)) {
    return Promise.reject(new Error(`Unknown notification channel '${channel}'`))
  }
  switch (filterOption) {
    case 'active':
      appIds = this.component.lifetime.activeSlots.toArray()
        .filter(it => appIds.indexOf(it) >= 0)
      break
    case 'running':
      appIds = appIds.filter(it => this.component.appScheduler.isAppRunning(it))
      break
  }

  if (params == null) {
    params = []
  }
  logger.info(`on system notification(${channel}): ${appIds} with filter option '${filterOption}'`)

  var self = this
  return step(0)

  function step (idx) {
    if (idx >= appIds.length) {
      return Promise.resolve()
    }
    var appId = appIds[idx]
    var future = Promise.resolve()
    if (filterOption !== 'all') {
      future = self.component.lifetime.createApp(appId)
        /** force quit app on create error */
        .catch(err => {
          logger.error(`create app ${appId} failed`, err.stack)
          return self.component.lifetime.destroyAppById(appId, { force: true })
            .then(() => { /** rethrow error to break following procedures */throw err })
        })
    }
    return future
      .then(() => self.component.lifetime.onLifeCycle(appId, 'notification', [ channel ].concat(params)))
      .catch(err => {
        logger.error(`send notification(${channel}) failed with appId: ${appId}`, err.stack)
      })
      .then(() => step(++idx))
  }
}

/**
 *
 * @param {string} appId -
 * @param {object} [options]
 * @param {'cut' | 'scene'} [options.form='cut'] - running form of the activity.
 * @param {string} [options.skillId] - update cloud skill stack if specified.
 */
AppRuntime.prototype.setForegroundById = function setForegroundById (appId, options) {
  var skillId = _.get(options, 'skillId')
  var form = _.get(options, 'form', 'cut')
  if (skillId) {
    if (this.component.appLoader.getAppIdBySkillId(skillId) !== appId) {
      return Promise.reject(new Error(`skill id '${skillId}' not owned by app ${appId}.`))
    }
    this.updateCloudStack(skillId, form)
  }
  return this.component.lifetime.setForegroundById(appId, form)
}

/**
 *
 * @param {boolean} [mute] - set mic to mute, switch mute if not given.
 */
AppRuntime.prototype.setMicMute = function setMicMute (mute, options) {
  var silent = _.get(options, 'silent', false)
  if (mute === this.component.turen.muted) {
    return Promise.resolve()
  }
  /** mute */
  var muted = this.component.turen.toggleMute()

  if (silent) {
    return this.component.light.stop('@yoda', 'system://setMuted.js')
  }

  return this.component.light.play(
    '@yoda',
    'system://setMuted.js',
    { muted: muted },
    { shouldResume: muted })
}

/**
 *
 * @param {object} [options] -
 * @param {boolean} [options.lightd=true] -
 * @param {boolean} [options.ttsd=true] -
 * @param {boolean} [options.multimediad=true] -
 */
AppRuntime.prototype.resetServices = function resetServices (options) {
  var lightd = _.get(options, 'lightd', true)
  var ttsd = _.get(options, 'ttsd', true)
  var multimediad = _.get(options, 'multimediad', true)
  logger.info('resetting services')

  var promises = []
  if (lightd) {
    promises.push(
      this.component.light.reset()
        .then((res) => {
          if (res && res[0] === true) {
            logger.log('reset lightd success')
          } else {
            logger.log('reset lightd failed')
          }
        })
        .catch((error) => {
          logger.log('reset lightd error', error)
        })
    )
  }
  if (ttsd) {
    promises.push(
      this.ttsMethod('reset', [])
        .then((res) => {
          if (res && res[0] === true) {
            logger.log('reset ttsd success')
          } else {
            logger.log('reset ttsd failed')
          }
        })
        .catch((error) => {
          logger.log('reset ttsd error', error)
        })
    )
  }
  if (multimediad) {
    promises.push(
      this.multimediaMethod('reset', [])
        .then((res) => {
          if (res && res[0] === true) {
            logger.log('reset multimediad success')
          } else {
            logger.log('reset multimediad failed')
          }
        })
        .catch((error) => {
          logger.log('reset multimediad error', error)
        })
    )
  }

  return Promise.all(promises)
}

/**
 * Update the app stack.
 * @private
 * @param {string} skillId -
 * @param {'cut' | 'scene'} form -
 * @param {object} [options] -
 * @param {boolean} [options.isActive] - if update currently active skillId
 */
AppRuntime.prototype.updateCloudStack = function (skillId, form, options) {
  if (this.component.appLoader.isSkillIdExcludedFromStack(skillId)) {
    return
  }

  var isActive = _.get(options, 'isActive', true)
  if (isActive) {
    this.domain.active = skillId
  }

  if (form === 'cut') {
    this.domain.cut = skillId
  } else if (form === 'scene') {
    this.domain.scene = skillId
  }
  var ids = [this.domain.scene, this.domain.cut]
  var stack = ids.join(':')
  this.component.flora.updateStack(stack)
}

AppRuntime.prototype.resetCloudStack = function () {
  this.domain.cut = ''
  this.domain.scene = ''
  this.domain.active = ''
  this.component.flora.updateStack(this.domain.scene + ':' + this.domain.cut)
}

AppRuntime.prototype.appPause = function appPause (appId) {
  logger.info('Pausing resources of app', appId)
  var promises = [
    this.component.light.stopSoundByAppId(appId),
    this.multimediaMethod('pause', [ appId ])
  ]
  return Promise.all(promises)
    .catch(err => logger.error('Unexpected error on pausing resources of app', appId, err.stack))
}

AppRuntime.prototype.appGC = function appGC (appId) {
  logger.info('Collecting resources of app', appId)
  var promises = [
    this.component.light.stopByAppId(appId),
    this.component.light.stopSoundByAppId(appId),
    this.multimediaMethod('stop', [ appId ]),
    this.ttsMethod('stop', [ appId ])
  ]
  if (this.component.lifetime.isAppInStack(appId)) {
    /**
     * clear app registrations and recover paused app if possible
     */
    promises.push(
      this.component.lifetime.deactivateAppById(appId)
    )
  } else if (this.component.lifetime.isBackgroundApp(appId)) {
    /**
     * clears background app registrations
     */
    promises.push(
      this.component.lifetime.destroyAppById(appId)
    )
  }
  return Promise.all(promises).catch(err => logger.error('Unexpected error on collecting resources of app', appId, err.stack))
}

/**
 * @param {boolean} isPickup
 * @private
 */
AppRuntime.prototype.setPickup = function (isPickup, duration, withAwaken) {
  if (this.component.turen.pickingUp === isPickup) {
    /** already at expected state */
    logger.info('turen already at picking up?', this.component.turen.pickingUp)
    return Promise.resolve()
  }

  if (this.component.turen.muted && isPickup) {
    logger.info('Turen has been muted, skip picking up.')
    return Promise.resolve()
  }

  logger.info('set turen picking up', isPickup)
  this.component.turen.pickup(isPickup)

  if (isPickup) {
    /** stop all other announcements on picking up */
    this.component.light.stopSoundByAppId('@yoda')
    this.component.light.stopByAppId('@yoda')
    return this.component.light.setPickup('@yoda', duration, withAwaken)
  }
  return this.component.light.stop('@yoda', 'system://setPickup.js')
}

AppRuntime.prototype.setConfirm = function (appId, intent, slot, options, attrs) {
  var currAppId = this.component.lifetime.getCurrentAppId()
  if (currAppId !== appId) {
    return Promise.reject(new Error(`App is not currently active app, active app: ${currAppId}.`))
  }
  return new Promise((resolve, reject) => {
    this.cloudApi.sendNlpConform(this.domain.active, intent, slot, options, attrs, (error) => {
      if (error) {
        return reject(error)
      }
      resolve()
    })
  }).then(() => this.setPickup(true))
}

AppRuntime.prototype.voiceCommand = function (text, options) {
  var isTriggered = _.get(options, 'isTriggered', false)
  var appId = _.get(options, 'appId')

  var skillOption = {
    device: {
      linkage: {
        trigger: isTriggered
      }
    }
  }
  return new Promise((resolve, reject) => {
    this.component.flora.getNlpResult(text, skillOption, function (err, nlp, action) {
      if (err) {
        return reject(err)
      }
      logger.info('get nlp result for asr', text, nlp, action)
      resolve([ nlp, action ])
    })
  }).then((result) => {
    var nlp = result[0]
    var action = result[1]
    var future = Promise.resolve()
    if (appId) {
      /**
       * retreat self-app into background, then promote the upcoming app
       * to prevent self being destroy in stack preemption.
       */
      future = this.component.lifetime.setBackgroundById(appId)
    }
    return future.then(() => this.onVoiceCommand(text, nlp, action, {
      carrierId: appId
    }))
  })
}

/**
 *
 * @param {string} appId -
 * @param {object} [options] -
 * @param {boolean} [options.clearContext] - also clears contexts
 */
AppRuntime.prototype.exitAppById = function exitAppById (appId, options) {
  var clearContext = _.get(options, 'clearContext', false)
  if (clearContext) {
    if (appId === this.component.appLoader.getAppIdBySkillId(this.domain.scene)) {
      this.updateCloudStack('', 'scene', { isActive: false })
    }
    if (appId === this.component.appLoader.getAppIdBySkillId(this.domain.cut)) {
      this.updateCloudStack('', 'cut', { isActive: false })
    }
  }
  return this.component.lifetime.deactivateAppById(appId)
}

/**
 * Register the dbus app.
 *
 * @param {string} appId extapp的AppID
 * @param {object} profile extapp的profile
 * @private
 */
AppRuntime.prototype.registerDbusApp = function (appId, objectPath, ifaceName) {
  logger.log('register dbus app with id: ', appId)
  try {
    this.component.appLoader.setManifest(appId, {
      objectPath: objectPath,
      ifaceName: ifaceName,
      skills: [ appId ],
      permission: ['ACCESS_TTS', 'ACCESS_MULTIMEDIA']
    }, {
      dbusApp: true
    })
  } catch (err) {
    if (_.startsWith(err.message, 'AppId exists')) {
      return
    }
    throw err
  }
  /** dbus apps are already running, creating a daemon app proxy for then */
  return this.component.lifetime.createApp(appId)
}

/**
 * @param {string} appId
 * @private
 */
AppRuntime.prototype.deleteDbusApp = function (appId) {}

/**
 * sync cloudappclient appid stack
 * @param {Array} stack appid stack
 * @private
 */
AppRuntime.prototype.syncCloudAppIdStack = function (stack) {
  this.cloudSkillIdStack = stack || []
  logger.log('cloudStack', this.cloudSkillIdStack)
  return Promise.resolve()
}

/**
 *
 * @param {string} skillId
 * @param {object} nlp
 * @param {object} action
 * @param {object} [options]
 * @param {boolean} [options.preemptive]
 */
AppRuntime.prototype.startApp = function (skillId, nlp, action, options) {
  nlp.cloud = false
  nlp.appId = skillId
  action = {
    appId: skillId,
    startWithActiveWord: false,
    response: {
      action: action || {}
    }
  }
  action.response.action.appId = skillId
  action.response.action.form = 'cut'
  return this.onVoiceCommand('', nlp, action, options)
}

/**
 * handle mqtt forward message
 * @param {string} message string receive from mqtt
 */
AppRuntime.prototype.onForward = function (message) {
  var data = {}
  try {
    data = JSON.parse(message)
  } catch (error) {
    data = {}
    logger.debug('parse mqtt forward message error: message -> ', message)
    return
  }
  if (typeof data.content === 'string') {
    /**
     * FIXME: compatibility with message format of android Rokid app
     */
    try {
      data.content = JSON.parse(data.content)
    } catch (err) {}
  }

  var skillId = data.appId || data.domain
  if (typeof skillId !== 'string') {
    logger.error('Expecting data.appId or data.domain exists in mqtt forward message.')
    return
  }
  var form = _.get(data, 'form')
  if (typeof form !== 'string') {
    form = _.get(this.component.appLoader.skillAttrsMap[skillId], 'defaultForm')
  }
  if (!form) {
    form = 'cut'
  }
  var preemptive = !_.get(data, 'getInfos', false)

  var mockNlp = {
    cloud: false,
    intent: 'RokidAppChannelForward',
    forwardContent: data.content,
    getInfos: data.getInfos,
    appId: skillId
  }
  var mockAction = {
    appId: skillId,
    version: '2.0.0',
    startWithActiveWord: false,
    response: {
      action: {
        appId: skillId,
        form: form
      }
    }
  }
  this.onVoiceCommand('', mockNlp, mockAction, { preemptive: preemptive })
}

/**
 * handle mqtt unbind topic
 */
AppRuntime.prototype.unBindDevice = function () {
  return Promise.resolve().then(() => {
    this.resetNetwork()
  })
}

/**
 * recover the default settings, it reboots when the request is done.
 */
AppRuntime.prototype.onResetSettings = function () {
  this.cloudApi.resetSettings().then(() => {
    logger.info('system is already reset')
    system.setRecoveryMode()
    process.nextTick(system.reboot)
  })
}

AppRuntime.prototype.shutdown = function shutdown () {
  logger.info('shuting down')
  this.component.light.play('@yoda', 'system://shutdown.js')
    .then(() => {
      if (this.component.battery.isCharging()) {
        return system.rebootCharging()
      }
      return system.powerOff()
    })
}

/**
 * @private
 */
AppRuntime.prototype.ttsMethod = function (name, args) {
  return this.component.dbusRegistry.callMethod(
    'com.service.tts',
    '/tts/service',
    'tts.service',
    name, args)
}

AppRuntime.prototype.multimediaMethod = function (name, args) {
  return this.component.dbusRegistry.callMethod(
    'com.service.multimedia',
    '/multimedia/service',
    'multimedia.service',
    name, args)
}

/**
 * @private
 */
AppRuntime.prototype.onGetPropAll = function () {
  return {}
}
