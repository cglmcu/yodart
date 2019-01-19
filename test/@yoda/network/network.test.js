'use strict'

var test = require('tape')
var Network = require('@yoda/network').Network
var mock = require('./mock.js')

test('Test wifi operations', function (t) {
  var network = new Network(new mock())

  t.equal(network.networkStatus.state, 'DISCONNECTED')
  t.equal(network.wifiStatus.state, 'DISCONNECTED')
  network.init()

  network.wifiOpen('test', 'passwd').then((reply) => {
    var msg = JSON.parse(reply.msg[0])
    t.equal(msg.result, 'OK')

    return new Promise (function (resolv, reject) {
      network.getStatus('WIFI').then((reply) => {
        var msg = JSON.parse(reply.msg[0])
        t.equal(msg.result, 'OK')
        t.equal(msg.wifi.state, 'CONNECTED')
        resolv()
      })
    }).then(() => {
      network.wifiClose().then((reply) => {
        network.getStatus('WIFI').then((reply) => {
          var msg = JSON.parse(reply.msg[0])
          t.equal(msg.wifi.state, 'DISCONNECTED')
          t.end()
        })
      })
    })
  })
})
