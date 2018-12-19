'use strict'

var logger = require('logger')('wormhole')
var AudioManager = require('@yoda/audio').AudioManager
var _ = require('@yoda/util')._
var ChildProcess = require('child_process')

var config = require('/etc/yoda/wormhole.json')

module.exports = Wormhole
function Wormhole (runtime) {
  this.runtime = runtime
  this.config = config
  if (this.config.handlers == null) {
    this.config.handlers = {}
  }
}

Wormhole.prototype.init = function init (mqttClient) {
  logger.info('initialize the wormhole with a new mqtt connection.')
  this.mqtt = mqttClient
  this.mqtt.setMessageHandler(this.messageHandler.bind(this))
}

Wormhole.prototype.messageHandler = function messageHandler (topic, text) {
  var descriptor = this.config.handlers[topic]
  if (descriptor != null) {
    if (descriptor.url) {
      if (typeof descriptor.url !== 'string') {
        logger.error('Malformed descriptor, url is not a string.', descriptor)
        return
      }
      var options = _.get(descriptor, 'options', {})
      if (typeof options !== 'object') {
        logger.error('Malformed descriptor, options is not an object.', descriptor)
        return
      }
      return this.runtime.openUrl(descriptor.url, options)
        .catch(err => {
          logger.error(`Unexpected error on opening url '${descriptor.url}'`, err && err.message, err && err.stack)
        })
    }
    if (descriptor.runtimeMethod) {
      var method = this.runtime[descriptor.runtimeMethod]
      var params = _.get(descriptor, 'params', [])
      if (typeof method !== 'function') {
        logger.error('Malformed descriptor, runtime method not found.', descriptor)
        return
      }
      if (!Array.isArray(params)) {
        logger.error('Malformed descriptor, params is not an array.', descriptor)
        return
      }

      return method.apply(this.runtime, params.concat(text))
    }
    if (descriptor.bin) {
      var cp = ChildProcess.spawn(descriptor.bin, descriptor.args || [], {
        stdio: 'inherit'
      })
      var timeout = descriptor.timeout || 10 * 1000
      var timer = setTimeout(() => {
        logger.info(`[${topic}] Spawned bin timed out for ${timeout}ms`)
        cp.kill(9)
      }, timeout)
      cp.once('exit', (code, signal) => {
        logger.info(`[${topic}] Spawned bin exited with code(${code}) signal(${signal})`)
        clearTimeout(timer)
      })
      return
    }
    logger.error('Unknown descriptor', descriptor)
  }

  var handler = this.handlers[topic]
  if (typeof handler !== 'function') {
    logger.warn('no handler for ' + topic)
    return
  }
  handler.call(this, text)
}

Wormhole.prototype.handlers = {
  /**
   * @member version
   */
  version: function () {
    return this.sendToApp('version', 'ok')
  },
  /**
   * @member asr
   */
  asr: function (asr) {
    this.runtime.flora.getNlpResult(asr, (err, nlp, action) => {
      if (err) {
        logger.error('occurrs some error in speechT', err)
      } else {
        logger.info('MQTT command: get nlp result for asr', asr, nlp, action)
        this.runtime.onVoiceCommand(asr, nlp, action)
      }
    })
  },
  /**
   * @member cloud_forward
   */
  cloud_forward: function (data) {
    try {
      var msg = JSON.parse(data)
      var params = JSON.parse(msg.content.params)
      this.runtime.onVoiceCommand('', params.nlp, params.action)
    } catch (err) {
      logger.error(err && err.stack)
    }
  },
  /**
   * @member forward
   */
  forward: function (data) {
    this.runtime.onForward(data)
  },
  /**
   * @member get_volume
   */
  get_volume: function () {
    this.updateVolume()
  },
  /**
   * @member set_volume
   */
  set_volume: function (data) {
    var msg = JSON.parse(data)
    if (msg.music !== undefined) {
      this.runtime.openUrl(`yoda-skill://volume/set_volume?value=${msg.music}`, { preemptive: false })
    }
  },
  /**
   * @member sys_update_available
   */
  sys_update_available: function () {
    logger.info('received upgrade command from mqtt, running ota in background.')
    this.runtime.openUrl('yoda-skill://ota/mqtt/check_update', { preemptive: false })
  },
  /**
   * @member reset_settings
   */
  reset_settings: function (data) {
    this.runtime.onResetSettings()
  },
  /**
   * @member custom_config
   */
  custom_config: function (data) {
    this.runtime.onCustomConfig(data)
  },
  /**
   * @member event
   */
  event: function (data) {
    if (typeof data === 'string') {
      try {
        data = JSON.parse(data)
      } catch (error) {
        logger.error('parse mqtt forward message error: message -> ', data)
        return
      }
    }
    this.handleAppEvent(data)
  },
  /**
   * @member UNIVERSAL_UNBIND
   */
  UNIVERSAL_UNBIND: function (data) {
    this.runtime.unBindDevice(data)
  }
}

Wormhole.prototype.sendToApp = function sendToApp (topic, data) {
  if (this.mqtt == null) {
    logger.info('not logged in and not connected, just skip to send data to app')
    return
  }
  if (typeof data !== 'string' && Buffer.isBuffer(data) === false) {
    data = JSON.stringify(data)
  }
  this.mqtt.sendToApp(topic, data)
  return Promise.resolve()
}

Wormhole.prototype.setOffline = function setOffline () {
  if (this.mqtt == null) {
    return
  }
  logger.info('disconnecting mqtt proactively')
  this.mqtt.suspend()
}

Wormhole.prototype.updateVolume = function updateVolume () {
  var res = {
    type: 'Volume',
    event: 'ON_VOLUME_CHANGE',
    template: JSON.stringify({
      mediaCurrent: AudioManager.getVolume(),
      mediaTotal: 100,
      alarmCurrent: AudioManager.getVolume(AudioManager.STREAM_ALARM),
      alarmTotal: 100
    }),
    appid: ''
  }
  logger.log('on request volume ->', res)
  this.sendToApp('event', res)
}

Wormhole.prototype.handleAppEvent = function handleAppEvent (data) {
  if (typeof data.appId !== 'string') {
    logger.error('Expecting data.appId exists in mqtt event message.')
    return
  }
  var form = _.get(data, 'form') || 'cut'
  var mockNlp = Object.assign({
    cloud: false,
    rokidAppCmd: true
  }, data)
  var mockAction = {
    appId: data.appId,
    version: '2.0.0',
    startWithActiveWord: false,
    response: {
      action: {
        appId: data.appId,
        form: form
      }
    }
  }
  this.runtime.onVoiceCommand('', mockNlp, mockAction)
}
