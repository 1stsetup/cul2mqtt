#!/usr/bin/env node

const Mqtt = require('mqtt');
const Cul = require('cul');
const log = require('yalm');
const pkg = require('./package.json');
const config = require('./config.js');

const topicMap = require(config.mapFile);

function map(topic) {
    return topicMap[topic] || topic;
}

let mqttConnected;
let culConnected;

log.setLevel(config.verbosity);

log.info(pkg.name, pkg.version, 'starting');

log.info('mqtt trying to connect', config.url);

const options = {will: {topic: config.name + '/connected', payload: '0', retain: true}};
if (config["mqtt-username"] && config["mqtt-password"]) {
    options.username = config["mqtt-username"];
    options.password = config["mqtt-password"];
}

const mqtt = Mqtt.connect(config.url, options);

function mqttPub(topic, payload, options) {
    if (typeof payload !== 'string') {
        payload = JSON.stringify(payload);
    }
    log.debug('mqtt >', topic, payload);
    mqtt.publish(topic, payload, options);
}

const cul = new Cul({
    serialport: config.serialport,
    mode: config.culMode,
    scc: config.scc ? true : false
});

mqttPub(config.name + '/connected', culConnected ? '2' : '1', {retain: true});

mqtt.on('connect', () => {
    mqttConnected = true;
    log.info('mqtt connected ' + config.url);
    mqtt.subscribe(config.prefix + '/set/#');
});

mqtt.on('close', () => {
    if (mqttConnected) {
        mqttConnected = false;
        log.info('mqtt closed ' + config.url);
    }
});

mqtt.on('error', (error) => {
    log.error('mqtt error ' + config.url + ', error:'+error);
});

cul.on('ready', () => {
    log.info('cul ready');
    culConnected = true;
    cul.write("V", () => {});

    mqttPub(config.name + '/connected', '2', {retain: true});
});

cul.on('data', (raw, obj) => {
    log.debug('<', raw, JSON.stringify(obj));

    const prefix = config.name + '/status/';
    let topic;
    const payload = {
        ts: new Date().getTime(),
        cul: {}
    };

    if (obj && obj.protocol && obj.data) {
        switch (obj.protocol) {
            case 'EM':
                topic = prefix + map(obj.protocol + '/' + obj.address);
                payload.val = obj.data.current;
                payload.cul.em = obj.data;
                if (obj.rssi) {
                    payload.cul.rssi = obj.rssi;
                }
                if (obj.device) {
                    payload.cul.device = obj.device;
                }
                log.debug('>', topic, payload);
                mqttPub(topic, payload, {retain: true});
                break;

            case 'HMS':
            case 'WS':
                Object.keys(obj.data).forEach(el => {
                    topic = prefix + map(obj.protocol + '/' + obj.address + '/' + el);
                    payload.val = obj.data[el];
                    if (obj.rssi) {
                        payload.cul.rssi = obj.rssi;
                    }
                    if (obj.device) {
                        payload.cul.device = obj.device;
                    }
                    log.debug('>', topic, payload);
                    mqttPub(topic, payload, {retain: true});
                });
                break;

            case 'FS20':
                topic = prefix + map('FS20/' + obj.address);
                payload.val = obj.data.cmdRaw;
                payload.cul.fs20 = obj.data;
                if (obj.rssi) {
                    payload.cul.rssi = obj.rssi;
                }
                if (obj.device) {
                    payload.cul.device = obj.device;
                }
                log.debug('>', topic, payload.val, payload.cul.fs20.cmd);
                mqttPub(topic, payload, {retain: false});
                break;

            case 'MORITZ':
                console.log("Moritz:"+JSON.stringify(obj,null,"\t"));
	        if (!obj.data.msgType) break;
                topic = prefix + map(obj.protocol + '/' + obj.address);
                payload.cul.data = obj.data;
                if (obj.rssi) {
                    payload.cul.rssi = obj.rssi;
                }
                if (obj.device) {
                    payload.cul.device = obj.device;
                }
                log.debug('>', topic, payload);
                mqttPub(topic, payload, {retain: true});
                break;

            default:
                log.warn('unknown protocol', obj.protocol);
        }
    }
});

cul.on('close', () => {
    culConnected = false;
    mqttPub(config.name + '/connected', '1', {retain: true});
});
