'use strict';

const RadioRa2 = require('./lib/radiora2');
const logger = require('./lib/logger');
const FanAccessory = require('./lib/accessories/fan');
const LightbulbAccessory = require('./lib/accessories/lightbulb');
const OccupancySensorAccessory = require('./lib/accessories/occupancysensor');
const KeypadButtonStatelessAccessory = require('./lib/accessories/statelessswitch');
const KeypadButtonAccessory = require('./lib/accessories/keypadbutton');
const VisorControlReceiverAccessory = require('./lib/accessories/visorcontrolreceiver');
const ThermostatAccessory = require('./lib/accessories/hvaccontroller');
const WindowCoveringAccessory = require('./lib/accessories/windowcovering');
const TemperatureSensorAccessory = require('./lib/accessories/temperaturesensor');
const PhantomButtonAccessory = require('./lib/accessories/phantombutton');

let Homebridge;
let Accessory;
let PlatformAccessory;
let Characteristic;
let Service;
let UUIDGen;

module.exports = function (homebridge) {
    Homebridge = homebridge;
    Accessory = homebridge.hap.Accessory;
    PlatformAccessory = homebridge.platformAccessory;
    Characteristic = homebridge.hap.Characteristic;
    Service = homebridge.hap.Service;
    UUIDGen = homebridge.hap.uuid;

    if (!Accessory.prototype.getServiceById) {
        Accessory.prototype.getServiceById =
            Accessory.prototype.getServiceByUUIDAndSubType;
    }

    if (!Service.Battery) {
        Service.Battery = Service.BatteryService;
    }

    homebridge.registerPlatform(
        'homebridge-radiora2',
        'RadioRA2',
        RadioRA2Platform,
        true
    );
};

function addDefaultValues(deviceConfig, deviceType) {
    deviceConfig.name = (
        deviceConfig.name ||
        `${deviceType} ${deviceConfig.id}`
    ).toString();

    deviceConfig.model = (
        deviceConfig.model ||
        `RadioRa2-${deviceType}`
    ).toString();

    deviceConfig.serial = (
        deviceConfig.serial ||
        `${deviceType}${deviceConfig.id}`
    ).toString();

    return deviceConfig;
}

class RadioRA2Platform {
    constructor(log, config, api) {
        if (
            !config ||
            !(config.host || config.repeater) ||
            !config.username ||
            !config.password
        ) {
            log.warn(
                'Ignoring Lutron RadioRa2 Platform setup because it is not configured'
            );
            this.disabled = true;
            return;
        }

        this.config = config;
        this.api = api;
        this.accessories = {};
        this.loaded = false;
        this.mainLoggedIn = false;
        this.qseLoggedIn = !config.qse;

        this.log = new logger.Logger(
            log,
            this.config.debug,
            this.config.rawMode
        );

        //this.log.info("***** QSE BUILD *****");
        //this.log.info(JSON.stringify(this.config, null, 2));

        this.setupConnections();
    }

    configureAccessory(accessory) {
        this.accessories[accessory.UUID] = accessory;
    }

    setupConnections() {
        const repeaterAddress =
            this.config.repeater || this.config.host;

        this.log.info(
            `Attempting connection to Main Repeater at ${repeaterAddress}...`
        );

        this.radiora2 = new RadioRa2(
            repeaterAddress,
            this.config.username,
            this.config.password,
            this.log,
            'Main Repeater'
        );

        this.radiora2.on('loggedIn', () => {
            this.mainLoggedIn = true;
            this.log.info(
                `Logged in to RadioRA2 Main Repeater at ${repeaterAddress}`
            );
            this.loadAccessoriesWhenReady();
        });

        this.radiora2.connect();

        this.log.info("Setting up QSE connection if configured...");

        if (this.config.qse && this.config.qse.host) {
            const qse = this.config.qse;
            const qseUsername =
                qse.username || this.config.username;
            const qsePassword =
                qse.password || this.config.password;

            this.log.info(
                `Attempting connection to QSE at ${qse.host}...`
            );

            this.qse = new RadioRa2(
                qse.host,
                qseUsername,
                qsePassword,
                this.log,
                'QSE'
            );

            this.qse.on('loggedIn', () => {
                this.qseLoggedIn = true;
                this.log.info(`Logged in to QSE at ${qse.host}`);
                this.loadAccessoriesWhenReady();
            });

            this.qse.connect();
        } else {
            this.qse = null;
            this.log.info(
                `Attempting connection to QSE at failed ${qse.host}...`
            );
        }

        process.on('SIGINT', () => this.disconnect());
        process.on('SIGTERM', () => this.disconnect());
    }

    disconnect() {
        if (this.radiora2) {
            this.radiora2.disconnect();
        }

        if (this.qse) {
            this.qse.disconnect();
        }
    }

    loadAccessoriesWhenReady() {
        if (
            this.loaded ||
            !this.mainLoggedIn ||
            !this.qseLoggedIn
        ) {
            return;
        }

        this.loaded = true;
        this.loadAccessories();
    }

    connectionFor(deviceConfig) {
        if (
            deviceConfig &&
            String(deviceConfig.connection || '').toLowerCase() === 'qse'
        ) {
            if (!this.qse) {
                throw new Error(
                    `Accessory "${deviceConfig.name || deviceConfig.id}" requests QSE, but qse.host is not configured`
                );
            }

            return this.qse;
        }

        return this.radiora2;
    }

    createAccessory(deviceType, deviceConfig, serviceFactory) {
        const source =
            String(deviceConfig.connection || 'main').toLowerCase();
        const uuid = UUIDGen.generate(
            `${deviceType}:${source}:${deviceConfig.id}`
        );

        let deviceAccessory = this.accessories[uuid];

        if (!deviceAccessory) {
            deviceAccessory = new PlatformAccessory(
                deviceConfig.name,
                uuid
            );

            if (serviceFactory) {
                serviceFactory(deviceAccessory);
            }

            this.api.registerPlatformAccessories(
                'homebridge-radiora2',
                'RadioRA2',
                [deviceAccessory]
            );
        }

        return { uuid, deviceAccessory };
    }

    loadAccessories() {
        this.loadFans();
        this.loadLights();
        this.loadOccupancySensors();
        this.loadKeypads();
        this.loadVisorControlReceivers();
        this.loadHVACControllers();
        this.loadWindowCoverings();
        this.loadQseButtons();
        this.removeDeletedAccessories();
    }

    loadFans() {
        const deviceType = 'fan';
        const deviceArray = this.config.fans || [];

        deviceArray.forEach((deviceConfig) => {
            if (deviceConfig.disabled || deviceConfig.exclude) {
                return;
            }

            if (!deviceConfig.id) {
                this.log.warn(`Invalid ${deviceType}. Not loading it.`);
                return;
            }

            deviceConfig = addDefaultValues(deviceConfig, deviceType);

            const result = this.createAccessory(
                deviceType,
                deviceConfig,
                (accessory) =>
                    accessory.addService(Service.Fan, deviceConfig.name)
            );

            this.accessories[result.uuid] = new FanAccessory(
                this.log,
                deviceConfig,
                result.deviceAccessory instanceof FanAccessory
                    ? result.deviceAccessory.accessory
                    : result.deviceAccessory,
                this.connectionFor(deviceConfig),
                Homebridge
            );

            this.accessories[result.uuid].existsInConfig = true;
        });

        this.log.info(
            `Loaded ${deviceArray.length} ${deviceType}(s)`
        );
    }

    loadLights() {
        const deviceType = 'light';
        const deviceArray = this.config.lights || [];

        deviceArray.forEach((deviceConfig) => {
            if (deviceConfig.disabled || deviceConfig.exclude) {
                return;
            }

            if (!deviceConfig.id) {
                this.log.warn(`Invalid ${deviceType}. Not loading it.`);
                return;
            }

            deviceConfig = addDefaultValues(deviceConfig, deviceType);

            const result = this.createAccessory(
                deviceType,
                deviceConfig,
                (accessory) => {
                    const service = accessory.addService(
                        Service.Lightbulb,
                        deviceConfig.name
                    );

                    if (deviceConfig.adjustable) {
                        service.addCharacteristic(
                            Characteristic.Brightness
                        );
                    }
                }
            );

            this.accessories[result.uuid] =
                new LightbulbAccessory(
                    this.log,
                    deviceConfig,
                    result.deviceAccessory instanceof LightbulbAccessory
                        ? result.deviceAccessory.accessory
                        : result.deviceAccessory,
                    this.connectionFor(deviceConfig),
                    Homebridge
                );

            this.accessories[result.uuid].existsInConfig = true;
        });

        this.log.info(
            `Loaded ${deviceArray.length} ${deviceType}(s)`
        );
    }

    loadOccupancySensors() {
        const deviceType = 'occupancy sensor';
        const deviceArray = this.config.occupancysensors || [];

        deviceArray.forEach((deviceConfig) => {
            if (deviceConfig.disabled || deviceConfig.exclude) {
                return;
            }

            if (!deviceConfig.id) {
                this.log.warn(`Invalid ${deviceType}. Not loading it.`);
                return;
            }

            deviceConfig = addDefaultValues(deviceConfig, deviceType);

            const result = this.createAccessory(
                deviceType,
                deviceConfig,
                (accessory) => {
                    const service = accessory.addService(
                        Service.OccupancySensor,
                        deviceConfig.name
                    );
                    service.addOptionalCharacteristic(
                        Characteristic.StatusActive
                    );
                }
            );

            this.accessories[result.uuid] =
                new OccupancySensorAccessory(
                    this.log,
                    deviceConfig,
                    result.deviceAccessory instanceof OccupancySensorAccessory
                        ? result.deviceAccessory.accessory
                        : result.deviceAccessory,
                    this.connectionFor(deviceConfig),
                    Homebridge
                );

            this.accessories[result.uuid].existsInConfig = true;
        });

        this.log.info(
            `Loaded ${deviceArray.length} ${deviceType}(s)`
        );
    }

    loadKeypads() {
        const deviceType = 'keypad';
        const deviceArray = this.config.keypads || [];

        deviceArray.forEach((deviceConfig) => {
            if (deviceConfig.disabled || deviceConfig.exclude) {
                return;
            }

            if (!deviceConfig.id) {
                this.log.warn(`Invalid ${deviceType}. Not loading it.`);
                return;
            }

            deviceConfig = addDefaultValues(deviceConfig, deviceType);

            const result = this.createAccessory(
                deviceType,
                deviceConfig
            );

            const AccessoryClass = deviceConfig.stateless
                ? KeypadButtonStatelessAccessory
                : KeypadButtonAccessory;

            this.accessories[result.uuid] = new AccessoryClass(
                this.log,
                deviceConfig,
                result.deviceAccessory instanceof AccessoryClass
                    ? result.deviceAccessory.accessory
                    : result.deviceAccessory,
                this.connectionFor(deviceConfig),
                Homebridge
            );

            this.accessories[result.uuid].existsInConfig = true;
        });

        this.log.info(
            `Loaded ${deviceArray.length} ${deviceType}(s)`
        );
    }

    loadVisorControlReceivers() {
        const deviceType = 'visor control receiver';
        const deviceArray =
            this.config.visorcontrolreceivers || [];

        deviceArray.forEach((deviceConfig) => {
            if (deviceConfig.disabled || deviceConfig.exclude) {
                return;
            }

            if (!deviceConfig.id) {
                this.log.warn(`Invalid ${deviceType}. Not loading it.`);
                return;
            }

            deviceConfig = addDefaultValues(deviceConfig, deviceType);

            const result = this.createAccessory(
                deviceType,
                deviceConfig
            );

            this.accessories[result.uuid] =
                new VisorControlReceiverAccessory(
                    this.log,
                    deviceConfig,
                    result.deviceAccessory instanceof VisorControlReceiverAccessory
                        ? result.deviceAccessory.accessory
                        : result.deviceAccessory,
                    this.connectionFor(deviceConfig),
                    Homebridge
                );

            this.accessories[result.uuid].existsInConfig = true;
        });

        this.log.info(
            `Loaded ${deviceArray.length} ${deviceType}(s)`
        );
    }

    loadHVACControllers() {
        const deviceType = 'hvac controller';
        const deviceArray =
            this.config.hvaccontrollers || [];

        deviceArray.forEach((deviceConfig) => {
            if (deviceConfig.disabled || deviceConfig.exclude) {
                return;
            }

            if (!deviceConfig.id) {
                this.log.warn(`Invalid ${deviceType}. Not loading it.`);
                return;
            }

            deviceConfig = addDefaultValues(deviceConfig, deviceType);

            const result = this.createAccessory(
                deviceType,
                deviceConfig,
                (accessory) =>
                    accessory.addService(
                        Service.Thermostat,
                        deviceConfig.name
                    )
            );

            this.accessories[result.uuid] =
                new ThermostatAccessory(
                    this.log,
                    deviceConfig,
                    result.deviceAccessory instanceof ThermostatAccessory
                        ? result.deviceAccessory.accessory
                        : result.deviceAccessory,
                    this.connectionFor(deviceConfig),
                    Homebridge
                );

            this.accessories[result.uuid].existsInConfig = true;

            const sensors = deviceConfig.sensors || [];

            sensors.forEach((sensorConfig) => {
                if (
                    sensorConfig.disabled ||
                    sensorConfig.exclude ||
                    !sensorConfig.id
                ) {
                    return;
                }

                sensorConfig.parentId = deviceConfig.id;
                sensorConfig.connection =
                    sensorConfig.connection ||
                    deviceConfig.connection;

                sensorConfig = addDefaultValues(
                    sensorConfig,
                    'temperature sensor'
                );

                const sensorResult = this.createAccessory(
                    'temperature sensor',
                    sensorConfig,
                    (accessory) =>
                        accessory.addService(
                            Service.TemperatureSensor,
                            sensorConfig.name
                        )
                );

                this.accessories[sensorResult.uuid] =
                    new TemperatureSensorAccessory(
                        this.log,
                        sensorConfig,
                        sensorResult.deviceAccessory instanceof TemperatureSensorAccessory
                            ? sensorResult.deviceAccessory.accessory
                            : sensorResult.deviceAccessory,
                        this.connectionFor(sensorConfig),
                        Homebridge
                    );

                this.accessories[
                    sensorResult.uuid
                ].existsInConfig = true;
            });
        });

        this.log.info(
            `Loaded ${deviceArray.length} ${deviceType}(s)`
        );
    }

    loadWindowCoverings() {
        const deviceType = 'window covering';
        const deviceArray =
            this.config.windowcoverings || [];

        deviceArray.forEach((deviceConfig) => {
            if (deviceConfig.disabled || deviceConfig.exclude) {
                return;
            }

            if (
                deviceConfig.id === undefined ||
                deviceConfig.id === null ||
                deviceConfig.id === ''
            ) {
                this.log.warn(`Invalid ${deviceType}. Not loading it.`);
                return;
            }

            deviceConfig = addDefaultValues(deviceConfig, deviceType);

            const result = this.createAccessory(
                deviceType,
                deviceConfig,
                (accessory) =>
                    accessory.addService(
                        Service.WindowCovering,
                        deviceConfig.name
                    )
            );

            this.accessories[result.uuid] =
                new WindowCoveringAccessory(
                    this.log,
                    deviceConfig,
                    result.deviceAccessory instanceof WindowCoveringAccessory
                        ? result.deviceAccessory.accessory
                        : result.deviceAccessory,
                    this.connectionFor(deviceConfig),
                    Homebridge
                );

            this.accessories[result.uuid].existsInConfig = true;
        });

        this.log.info(
            `Loaded ${deviceArray.length} ${deviceType}(s)`
        );
    }

    loadQseButtons() {
        const deviceType = 'qse phantom button';
        const deviceArray = this.config.qsebuttons || [];

        deviceArray.forEach((deviceConfig) => {
            if (deviceConfig.disabled || deviceConfig.exclude) {
                return;
            }

            if (
                deviceConfig.button === undefined ||
                deviceConfig.button === null
            ) {
                this.log.warn(
                    `Invalid ${deviceType}. Missing button number.`
                );
                return;
            }

            deviceConfig.id =
                deviceConfig.id ||
                deviceConfig.deviceId ||
                'CI';

            deviceConfig.connection = 'qse';
            deviceConfig = addDefaultValues(
                deviceConfig,
                deviceType
            );

            const result = this.createAccessory(
                deviceType,
                {
                    ...deviceConfig,
                    id: `${deviceConfig.id}:${deviceConfig.button}`
                },
                (accessory) =>
                    accessory.addService(
                        Service.Switch,
                        deviceConfig.name
                    )
            );

            this.accessories[result.uuid] =
                new PhantomButtonAccessory(
                    this.log,
                    deviceConfig,
                    result.deviceAccessory instanceof PhantomButtonAccessory
                        ? result.deviceAccessory.accessory
                        : result.deviceAccessory,
                    this.connectionFor(deviceConfig),
                    Homebridge
                );

            this.accessories[result.uuid].existsInConfig = true;
        });

        this.log.info(
            `Loaded ${deviceArray.length} ${deviceType}(s)`
        );
    }

    removeDeletedAccessories() {
        Object.keys(this.accessories).forEach((accessoryUuid) => {
            const item = this.accessories[accessoryUuid];

            if (item.existsInConfig !== true) {
                const accessory =
                    item.accessory || item;

                this.api.unregisterPlatformAccessories(
                    'homebridge-radiora2',
                    'RadioRA2',
                    [accessory]
                );

                delete this.accessories[accessoryUuid];
                this.log.info('Deleted removed accessory');
            }
        });
    }
}
