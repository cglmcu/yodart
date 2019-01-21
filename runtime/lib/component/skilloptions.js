'use strict'

var floraName = 'skilloptions-builder'
var floraConfig = require('/etc/yoda/flora-config.json')
var flora = require('@yoda/flora')
var mmStatGetter = 'rokid.multimedia.state'
var mmStatHolder = 'multimediad'

function Builder() {
  this.agent = new flora.Agent(floraConfig.uri + '#' + floraName)
}

function buildSkillOptions(mmStat) {
  if (!Array.isArray(mmStat)) {
    return undefined
  }
  // TODO: build skill options json string
  return undefined
}

Builder.prototype.init = () => {
  this.agent.declareMethod('rokid.skilloptions.provider', (msg, reply) => {
    this.agent.call(mmStatGetter, undefined, mmStatHolder, 100).then((result) => {
      var skillOptions = buildSkillOptions(result)
      if (typeof skillOptions === 'string') {
        reply.end(0, [ skillOptions ])
      } else {
        reply.end(-301)
      }
    }, (err) => {
      reply.end(err)
    })
  })
  this.agent.start()
}

module.exports = Builder
