'use strict';

const TuyaSpecificCluster = require("../../lib/TuyaSpecificCluster");
const TuyaOnOffCluster = require("../../lib/TuyaOnOffCluster");
const TuyaSpecificClusterDevice = require("../../lib/TuyaSpecificClusterDevice");
const { getDataValue } = require("./helpers");
const { Cluster } = require("zigbee-clusters");

Cluster.addCluster(TuyaOnOffCluster);
Cluster.addCluster(TuyaSpecificCluster);

/**
 * These are the "Data points" which the Tuya cluster exposes, and can be written against.
 *
 * At the time of writing this code, I could not find any documentation of Tuya cluster:
 * https://developer.tuya.com/en/docs/iot/categorywk?id=Kaiuz1m1xqnt6
 */
const THERMOSTAT_DATA_POINTS = {
    onOff: 1,
    /* 0: cool, 1: heat, 2: fan only */
    thermostatMode: 2,
    ecoMode: 4,
    targetTemperature: 16,
    maxTemperature: 19,
    currentTemperature: 24,
    minTemperature: 26,
    temperatureCalibration: 27,
    /* 0: low, 1: medium, 2: high, 3: auto */
    fanMode: 28,
    /* valve state: 0: relay is on (valve is open), 1: relay is off (valve is closed) */
    valveStatus: 36,
    childLock: 40,
    deadzoneTemperature: 103,
    minTemperatureLimit: 104,
    maxTemperatureLimit: 105,
    manualMode: 101,
}

// see: https://github.com/zigpy/zha-device-handlers/issues/2433
//# info from https://github.com/zigpy/zha-device-handlers/pull/538#issuecomment-723334124
//# https://github.com/Koenkk/zigbee-herdsman-converters/blob/master/converters/fromZigbee.js#L239
//# and https://github.com/Koenkk/zigbee-herdsman-converters/blob/master/converters/common.js#L113
// first number: is the data type. for example: TARGET_TEMP_ATTR = 0x0210 => 2: number, 0x10: 16
// MOESBHT_TARGET_TEMP_ATTR = 0x0210  # [0,0,0,21] target room temp (degree)
// MOESBHT_TEMPERATURE_ATTR = 0x0218  # [0,0,0,200] current room temp (decidegree)
// MOESBHT_SCHEDULE_MODE_ATTR = 0x0403  # [1] false [0] true   /!\ inverted
// MOESBHT_MANUAL_MODE_ATTR = 0x0402  # [1] false [0] true /!\ inverted
// MOESBHT_ENABLED_ATTR = 0x0101  # [0] off [1] on
// MOESBHT_RUNNING_MODE_ATTR = 0x0424  # [1] idle [0] heating /!\ inverted
// MOESBHT_CHILD_LOCK_ATTR = 0x0128  # [0] unlocked [1] child-locked



// See: https://github.com/Koenkk/zigbee-herdsman-converters/blob/master/src/devices/tuya.ts
// search for: TYBAC-006
// see device info: https://www.zigbee2mqtt.io/devices/TYBAC-006.html

// [1, 'state', tuya.valueConverter.onOff],
// [2, 'system_mode', tuya.valueConverterBasic.lookup({'cool': tuya.enum(0), 'heat': tuya.enum(1), 'fan_only': tuya.enum(2)})],
// [4, 'eco_mode', tuya.valueConverter.onOff],
// [16, 'current_heating_setpoint', tuya.valueConverter.divideBy10],
// [19, 'max_temperature', tuya.valueConverter.divideBy10],
// [24, 'local_temperature', tuya.valueConverter.divideBy10],
// [26, 'min_temperature', tuya.valueConverter.divideBy10],
// [27, 'local_temperature_calibration', tuya.valueConverter.localTemperatureCalibration],
// [28, 'fan_mode', tuya.valueConverterBasic.lookup(
//     {'low': tuya.enum(0), 'medium': tuya.enum(1), 'high': tuya.enum(2), 'auto': tuya.enum(3)})],
// [36, 'valve', tuya.valueConverterBasic.lookup({'OPEN': 0, 'CLOSE': 1})],
// [40, 'child_lock', tuya.valueConverter.lockUnlock],
// [103, 'deadzone_temperature', tuya.valueConverter.raw],
// [104, 'min_temperature_limit', tuya.valueConverter.divideBy10],
// [105, 'max_temperature_limit', tuya.valueConverter.divideBy10],
// [106, 'schedule_sunday', tuya.valueConverter.thermostatScheduleDayMultiDPWithDayNumber(7)],
// [107, 'schedule_saturday', tuya.valueConverter.thermostatScheduleDayMultiDPWithDayNumber(6)],
// [108, 'schedule_friday', tuya.valueConverter.thermostatScheduleDayMultiDPWithDayNumber(5)],
// [109, 'schedule_thursday', tuya.valueConverter.thermostatScheduleDayMultiDPWithDayNumber(4)],
// [110, 'schedule_wednesday', tuya.valueConverter.thermostatScheduleDayMultiDPWithDayNumber(3)],
// [111, 'schedule_tuesday', tuya.valueConverter.thermostatScheduleDayMultiDPWithDayNumber(2)],
// [112, 'schedule_monday', tuya.valueConverter.thermostatScheduleDayMultiDPWithDayNumber(1)],
// [101, 'manual_mode', tuya.valueConverter.onOff],


/**
 * `WallThermostatDevice` makes the Tuya Wall Thermostat for Electric Floor heating (BHT-002-GCLZB) available in Homey.
 *  The device can be set to a target temperature, turned on and off, and will show current temperature.
 *
 * Most likely also works for the Water/Gas Boiler and Water heating version too.
 * https://smarthomescene.com/reviews/moes-zigbee-smart-thermostat-bht-002/
 *
 * Device manual:
 * https://manuals.plus/beca/bht-002-series-wifi-thermostat-manual.pdf
 *
 * Implementation details:
 * - The device does not implement cluster attributes for thermostat, deviceTemperature, and temperatureMeasurement clusters.
 * - This code is using the Tuya cluster to receive and send Tuya data points back and forth between Homey and the Wall Thermostat.
 */
class FanCoilThermostatDevice extends TuyaSpecificClusterDevice {
    async onNodeInit({ zclNode }) {
        this.printNode();
        this.enableDebug();

        await zclNode.endpoints[1].clusters.basic.readAttributes('manufacturerName', 'zclVersion', 'appVersion', 'modelId', 'powerSource', 'attributeReportingStatus')

        this.registerCapabilityListener('target_temperature', async (targetTemperature) => {
            await this.writeData32(THERMOSTAT_DATA_POINTS.targetTemperature, targetTemperature * 10);
            this.log('Target temperature set', targetTemperature);
        });

        this.registerCapabilityListener('onoff', async (onOff) => {
            //  await this.writeBool(THERMOSTAT_DATA_POINTS.onOff, onOff)
            this.log('device on/off set', onOff);
        });

        this.registerCapabilityListener('measure_temperature', async (currentTemperature) => {
            this.log('current temperature received', currentTemperature);
        });

        this.registerCapabilityListener('thermostat_mode', async (value) => {
            const valueToSendOut = value === 'cool'
                ? 0
                : value === 'heat'
                    ? 1
                    : 2;

            await this.writeEnum(THERMOSTAT_DATA_POINTS.thermostatMode, valueToSendOut);
            this.log(`Mode set to ${value}`);
        });

        this.registerCapabilityListener('fan_mode', async (value) => {
            const valueToSendOut = value === 'low'
                ? 0
                : value === 'medium'
                    ? 1
                    : value === 'high'
                        ? 2
                        : 3;
            await this.writeEnum(THERMOSTAT_DATA_POINTS.fanMode, valueToSendOut);
            this.log(`Fan speed set to ${value} (${valueToSendOut})`);
        });

        zclNode.endpoints[1].clusters.tuya.on("response", value => this.processResponse(value));

        this.log("Fan Coil Thermostat booted up!");
    }

    async onSettings({ oldSettings, newSettings, changedKeys }) {
        this.log("Settings changed", changedKeys, newSettings);

        const newTemperatureCalibration = newSettings.temperatureCalibration;
        if (changedKeys.includes('temperatureCalibration')) {
            await this.writeData32(THERMOSTAT_DATA_POINTS.temperatureCalibration, newTemperatureCalibration);
        }
    }

    async processResponse(data) {
        //this.log("data arrived");

        const dp = data.dp;
        const parsedValue = getDataValue(data);

        switch (dp) {
            case THERMOSTAT_DATA_POINTS.thermostatMode:
                this.log('Thermostat mode received', parsedValue);

                try {
                    const capabilityValue = parsedValue === 0
                        ? 'cool'
                        : parsedValue === 1
                            ? 'heat'
                            : 'off';

                    await this.setCapabilityValue('thermostat_mode', capabilityValue);
                } catch (e) {
                    this.log("Failed to forward thermostat mode to app", e);
                }

                await this.updateFanSpeedCapabilityAsync();

                break;

            case THERMOSTAT_DATA_POINTS.currentTemperature:
                this.log('Current temperature received', parsedValue);

                try {
                    await this.setCapabilityValue('measure_temperature', parsedValue / 10)
                } catch (e) {
                    this.log("Failed to forward current temperature to app", e);
                }

                await this.updateFanSpeedCapabilityAsync();

                break;

            case THERMOSTAT_DATA_POINTS.targetTemperature:
                this.log('Target Temperature received', parsedValue);

                try {
                    await this.setCapabilityValue('target_temperature', parsedValue / 10);
                } catch (e) {
                    this.log("Failed to set target temperature", e);
                }

                await this.updateFanSpeedCapabilityAsync();

                break;

            case THERMOSTAT_DATA_POINTS.onOff:
                this.log('Thermostat on/off received', parsedValue);

                try {
                    await this.setCapabilityValue('onoff', parsedValue);
                } catch (e) {
                    this.log("Failed to forward on/off to app", e);
                }

                break;

            case THERMOSTAT_DATA_POINTS.fanMode:
                this.log('Fan mode received', parsedValue);

                try {
                    const fanMode = parsedValue === 0
                        ? 'low'
                        : parsedValue === 1
                            ? 'medium'
                            : parsedValue === 2
                                ? 'high'
                                : 'auto';
                    await this.setCapabilityValue('fan_mode', fanMode);
                } catch (e) {
                    this.log("Failed to forward fan mode to app", e);
                }

                await this.updateFanSpeedCapabilityAsync();

                break;

            case THERMOSTAT_DATA_POINTS.valveStatus:
                this.log(`*********************** Valve status received: ${parsedValue === 1
                    ? "closed"
                    : "open"} value: ${parsedValue}`);

                try {
                    await this.setCapabilityValue('valve_status', parsedValue === 1
                        ? "closed"
                        : "open");
                } catch (e) {
                    this.log("Failed to forward valve status to app", e);
                }

                await this.updateFanSpeedCapabilityAsync();

                break;
            default:
                this.log('Data Point', dp, parsedValue)
        }
    }

    async updateFanSpeedCapabilityAsync() {
        try {
            const fanSpeed = this.getFanSpeed();
            this.log('Calculated Fan speed:', fanSpeed);
            await this.setCapabilityValue('fan_speed', fanSpeed);
        } catch (e) {
            this.log("Failed to forward current fan speed to app", e);
        }
    }

    /*
    // valve open:
    // fan auto =>
    // < 0,5 diff: OFF
    // 0,5-1,5 diff: I
    // 1,5-2,5 diff: II
    // >2,5, diff: III
    */
    getFanSpeed() {
        // todo: if device is off, then return off
        // else:
        // todo: get fan mode
        const fanMode = this.getCapabilityValue('fan_mode');
        console.log('fanMode:', fanMode);
        // if not auto, then return the value
        if (fanMode !== 'auto') {
            return fanMode; // will return low/medium/high
        } else {
            // fan mode is auto, so we need further calculation
            const thermostatMode = this.getCapabilityValue('thermostat_mode');
            console.log('thermostatMode:', thermostatMode);
            if (thermostatMode === 'heat' || thermostatMode === 'cool') {
                // if heat or cool, then:
                const valveStatus = this.getCapabilityValue('valve_status');
                if (valveStatus === 'closed') {
                    // valve is closed, so we are sure, that the ventilation is off
                    return 'off';
                }
                else {
                    // valve is open, check the temperature difference
                    const targetTemperature = this.getCapabilityValue('target_temperature');
                    const currentTemperature = this.getCapabilityValue('measure_temperature');
                    const diff = Math.abs(targetTemperature - currentTemperature);
                    if (diff < 0.5) {
                        return 'off';
                    } else if (diff < 1.5) {
                        return 'low';
                    } else if (diff < 2.5) {
                        return 'medium';
                    } else {
                        return 'high';
                    }
                }
            }
        }
        return 'off';
    }

}

module.exports = FanCoilThermostatDevice;
