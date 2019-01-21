'use strict'

var flora = require('@yoda/flora')
var floraConfig = require('/etc/yoda/flora-config.json')
var floraName = 've-turntable'
var mqttTopic = 'yoda/display/speech/110'

function VoiceEventTurntable(runtime) {
  this.runtime = runtime
  this.floraAgent = new flora.Agent(floraConfig.uri + '#' + floraName)
}

VoiceEventTurntable.prototype.init = function() {
  this.floraAgent.subscribe('rokid.turen.start_voice', (msg) => {
    if (Array.isArray(msg) && typeof msg[3] === 'number') {
      var mqttMsg = { type: 'vad-start', data: { power: msg[3] } }
      var mqtt = this.getMqtt()
      console.log('mqtt publish speech event:', mqttMsg)
      if (mqtt) {
        mqtt.publish(mqttTopic, JSON.stringify(mqttMsg))
      }
    }
  })
  this.floraAgent.subscribe('rokid.speech.inter_asr', (msg) => {
    if (Array.isArray(msg) && typeof msg[0] === 'string') {
      var mqttMsg = { type: 'asr', data: { asr: msg[0] } }
      var mqtt = this.getMqtt()
      console.log('mqtt publish speech event:', mqttMsg)
      if (mqtt) {
        mqtt.publish(mqttTopic, JSON.stringify(mqttMsg))
      }
    }
  })
  this.floraAgent.subscribe('rokid.speech.nlp', (msg) => {
    if (Array.isArray(msg) && typeof msg[0] === 'string' && typeof msg[1] === 'string') {
      var nlp, action
      try {
        nlp = JSON.parse(msg[0])
        action = JSON.parse(msg[1])
      } catch (err) {
        console.log('parse nlp/action failed')
        nlp = action = undefined
      }
      var mqttMsg = { type: 'nlp', data: {} }
      if (nlp) {
        mqttMsg.data.nlp = nlp
        mqttMsg.data.action = action
      }
      var mqtt = this.getMqtt()
      console.log('mqtt publish speech event:', mqttMsg)
      if (mqtt) {
        mqtt.publish(mqttTopic, JSON.stringify(mqttMsg))
      }
    }
  })
  this.floraAgent.subscribe('rokid.speech.error', (msg) => {
    if (Array.isArray(msg) && typeof msg[0] === 'number') {
      var mqttMsg = { type: 'error', data: { code: msg[0] } }
      var mqtt = this.getMqtt()
      console.log('mqtt publish speech event:', mqttMsg)
      if (mqtt) {
        mqtt.publish(mqttTopic, JSON.stringify(mqttMsg))
      }
    }
  })
  this.floraAgent.start()
}

VoiceEventTurntable.prototype.getMqtt = function () {
  if (this.mqttClient) {
    return this.mqttClient
  }
  if (this.runtime.component.wormhole.mqtt) {
    this.mqttClient = this.runtime.component.wormhole.mqtt._mqttHandle
  }
  return this.mqttClient
}

module.exports = VoiceEventTurntable
