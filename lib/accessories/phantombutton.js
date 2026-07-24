'use strict';

let Characteristic;
let Service;

module.exports = class PhantomButtonAccessory {
    constructor(log, config, accessory, radiora2, homebridge) {
        Characteristic = homebridge.hap.Characteristic;
        Service = homebridge.hap.Service;

        this.log = log;
        this.config = config;
        this.accessory = accessory;
        this.radiora2 = radiora2;
        this.resetTimer = null;

        this.accessory
            .getService(Service.AccessoryInformation)
            .setCharacteristic(
                Characteristic.Manufacturer,
                'Lutron'
            )
            .setCharacteristic(
                Characteristic.Model,
                this.config.model || 'QSE Phantom Button'
            )
            .setCharacteristic(
                Characteristic.SerialNumber,
                this.config.serial ||
                    `QSE-${this.config.id}-${this.config.button}`
            );

        this.setupListeners();
    }

    setupListeners() {
        const switchService =
            this.accessory.getService(Service.Switch);

        switchService
            .getCharacteristic(Characteristic.On)
            .on('get', (callback) => callback(null, false))
            .on('set', this.setOn.bind(this));

        switchService
            .getCharacteristic(Characteristic.On)
            .updateValue(false);
    }

    setOn(value, callback) {
        if (!value) {
            callback(null);
            return;
        }

        const deviceId =
            this.config.id ||
            this.config.deviceId ||
            'CI';

        this.log.info(
            `Pressing QSE phantom button ${deviceId}:${this.config.button}`
        );

        this.radiora2.pressButton(
            deviceId,
            this.config.button,
            this.config.sendRelease !== false
        );

        if (this.resetTimer) {
            clearTimeout(this.resetTimer);
        }

        this.resetTimer = setTimeout(() => {
            this.accessory
                .getService(Service.Switch)
                .getCharacteristic(Characteristic.On)
                .updateValue(false);
        }, Number(this.config.resetDelay || 500));

        callback(null);
    }
};