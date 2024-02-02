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
*/
const THERMOSTAT_DATA_POINTS = {
    onOff: 1,
    thermostatMode: 2,
    targetTemperature: 16,
    currentTemperature: 24,
    fanMode: 28,
    // valve or fan relay state: 0: relay is on, 1: relay is off
    valveStatus: 36
}

/**
 * `FanCoilThermostatDevice` makes the Tuya Fan Coil Thermostat available in Homey.
 *  The device can be set to a target temperature, mode can be selected, will show current temperature.
  * Where to buy the device: https://www.aliexpress.com/item/1005005650411387.html
 *
 * Implementation details:
 * - The device does not implement cluster attributes for thermostat, deviceTemperature, and temperatureMeasurement clusters.
 * - This code is using the Tuya cluster to receive and send Tuya data points back and forth between Homey and the Thermostat.
 */
class FanCoilThermostatDevice extends TuyaSpecificClusterDevice {
    async onNodeInit({ zclNode }) {
        this.printNode();
        this.enableDebug();

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
            if (value === 'cool') {
                await this.writeEnum(THERMOSTAT_DATA_POINTS.thermostatMode, 0);
            } else if (value === 'heat') {
                await this.writeEnum(THERMOSTAT_DATA_POINTS.thermostatMode, 1);
            } else {
                await this.writeEnum(THERMOSTAT_DATA_POINTS.thermostatMode, 2);
            }
            this.log(`Mode set to ${value}`);
        });

        zclNode.endpoints[1].clusters.tuya.on("response", value => this.processResponse(value));

        this.log("Fan Coil Thermostat booted up!");
    }

    async processResponse(data) {
        const dp = data.dp;
        const parsedValue = getDataValue(data);

        switch (dp) {
            case THERMOSTAT_DATA_POINTS.thermostatMode:
                this.log('Thermostat mode received', parsedValue);
                if (parsedValue == 0) {
                    //cool
                    this.setCapabilityValue('thermostat_mode', 'cool');
                }
                else if (parsedValue == 1) {
                    //heat
                    this.setCapabilityValue('thermostat_mode', 'heat');
                } else {
                    // unknown
                    this.setCapabilityValue('thermostat_mode', 'off');
                }
                break;
            case THERMOSTAT_DATA_POINTS.currentTemperature:
                this.log('Current temperature received', parsedValue);

                try {
                    await this.setCapabilityValue('measure_temperature', parsedValue / 10)
                } catch (e) {
                    this.log("Failed to set current temperature", e);
                }

                break;

            case THERMOSTAT_DATA_POINTS.targetTemperature:
                this.log('Target Temperature received', parsedValue);

                try {
                    await this.setCapabilityValue('target_temperature', parsedValue / 10);
                } catch (e) {
                    this.log("Failed to set target temperature", e);
                }

                break;

            case THERMOSTAT_DATA_POINTS.onOff:
                this.log('Thermostat on/off received', parsedValue);

                try {
                    await this.setCapabilityValue('onoff', parsedValue);
                } catch (e) {
                    this.log("Failed to set on/off", e);
                }

                break;
            case THERMOSTAT_DATA_POINTS.fanMode:
                this.log('Fan mode received', parsedValue);
                break;

            case THERMOSTAT_DATA_POINTS.valveStatus:
                this.log(`*********************** Valve status received: ${parsedValue === 1
                    ? "closed"
                    : "open"} value: ${parsedValue}`);
                break;
            default:
                this.log('Data Point', dp, parsedValue)
        }
    }
}

module.exports = FanCoilThermostatDevice;
