import sdk, { Settings, DeviceBase, MixinProvider, ScryptedDeviceBase, ScryptedDeviceType, ScryptedInterface, WritableDeviceState, Setting, SettingValue, DeviceInformation, Sensors } from "@scrypted/sdk";
import OsdManagerMixin from "./cameraMixin";
import { convertSettingsToStorageSettings, deviceFilter, getStrippedNativeId, getTemplateKeys, osdManagerPrefix, SupportedDevice } from "./utils";
import { StorageSetting, StorageSettings, StorageSettingsDict } from "@scrypted/sdk/storage-settings";
import { template } from "lodash";
import { UnitConverter } from "../../scrypted-homeassistant/src/unitConverter";

export default class OsdManagerProvider extends ScryptedDeviceBase implements MixinProvider, Settings {
    initStorage: StorageSettingsDict<string> = {
        lockText: {
            title: 'Locked State Text',
            type: 'string',
            defaultValue: 'Locked',
        },
        unlockText: {
            title: 'Unlocked State Text',
            type: 'string',
            defaultValue: 'Unlocked',
        },
        openText: {
            title: 'Open State Text',
            type: 'string',
            defaultValue: 'Open',
        },
        closedText: {
            title: 'Closed State Text',
            type: 'string',
            defaultValue: 'Closed',
        },
        jammedText: {
            title: 'Jammed State Text',
            type: 'string',
            defaultValue: 'Jammed',
        },
        templates: {
            title: 'Templates',
            description: 'Define templates from multiple devices',
            type: 'string',
            multiple: true,
            defaultValue: [],
            choices: [],
            combobox: true,
            onPut: () => this.refreshSettings()
        },
    };
    storageSettings = new StorageSettings(this, this.initStorage);

    public mixinsMap: Record<string, OsdManagerMixin> = {};

    constructor(nativeId: string) {
        super(nativeId);

        this.refreshSettings().catch();
    }

    async refreshSettings() {
        const dynamicSettings: StorageSetting[] = [];
        const { templates } = this.storageSettings.values;
    
        for (const templateId of templates) {
            const {
                devicesKey,
                getSensorKeys,
                getDeviceKeys,
                group,
                parserStringKey,
            } = getTemplateKeys(templateId);
    
            dynamicSettings.push(
                {
                key: devicesKey,
                title: 'Device',
                type: 'device',
                group,
                deviceFilter,
                multiple: true,
                onPut: this.refreshSettings,
                },
            );
    
            const deviceIds = JSON.parse(this.storage.getItem(devicesKey) ?? '[]');
            const availableSensorIds: string[] = [];
    
            for (const deviceId of deviceIds) {
                const device = sdk.systemManager.getDeviceById(deviceId) as unknown as ScryptedDeviceBase;
                if (device && device.interfaces.includes(ScryptedInterface.Sensors)) {
                    const sensorDevice = device as unknown as Sensors;
                    const { sensorsKey } = getDeviceKeys(deviceId);
                    const sensorIds = Object.keys(sensorDevice.sensors ?? {});
                    dynamicSettings.push({
                        key: sensorsKey,
                        title: `Available sensors on device "${device.name}"`,
                        description: `Select the sensors to make available on the template. Access it on the parser with "{${deviceId}.sensorName}"`,
                        type: 'string',
                        group,
                        choices: sensorIds,
                        immediate: true,
                        combobox: true,
                        multiple: true,
                        onPut: this.refreshSettings,
                    });
    
                    const selectedSensorIds = JSON.parse(this.storage.getItem(sensorsKey) ?? '[]');
                    for (const sensorId of selectedSensorIds) {
                        availableSensorIds.push(`{${device.id}.${sensorId}}`);

                        const { maxDecimalsKey, unitKey } = getSensorKeys(sensorId);
                        const sensorData = sensorDevice.sensors[sensorId];
                        const unit = sensorData?.unit;

                        if (unit) {
                            const possibleUnits = UnitConverter.getUnits(unit);

                        dynamicSettings.push(
                            {
                                key: unitKey,
                                title: 'Unit',
                                type: 'string',
                                subgroup: sensorId,
                                defaultValue: possibleUnits[0],
                                group,
                                immediate: true,
                                choices: possibleUnits,
                            },
                        )
                        }

                    dynamicSettings.push(
                        {
                            key: maxDecimalsKey,
                            title: 'Max Decimals',
                            type: 'number',
                            subgroup: sensorId,
                            defaultValue: 1,
                            group,
                        });
                    }
                } else if (device) {
                    const strippedNativeId = getStrippedNativeId(device);         
                    availableSensorIds.push(`{${device.id}.${strippedNativeId}}`);
                    if (device.interfaces.includes(ScryptedInterface.Thermometer)) {
                        const thermoDevice = device as any; 
                        const { maxDecimalsKey, unitKey } = getSensorKeys('temperature');
                        const sensorData = { value: thermoDevice.temperature, unit: thermoDevice.temperatureUnit };
                        if (sensorData.unit) {
                            const possibleUnits = UnitConverter.getUnits(sensorData.unit);
                            dynamicSettings.push({
                                key: unitKey,
                                title: 'Unit',
                                type: 'string',
                                subgroup: 'temperature',
                                defaultValue: possibleUnits[0],
                                group,
                                immediate: true,
                                choices: possibleUnits,
                            });
                        }
                        dynamicSettings.push({
                            key: maxDecimalsKey,
                            title: 'Max Decimals',
                            type: 'number',
                            subgroup: 'temperature',
                            defaultValue: 1,
                            group,
                        });
                    } else if (device.interfaces.includes(ScryptedInterface.HumiditySensor)) {
                        const humidityDevice = device as any; // Treat as HumiditySensor
                        const { maxDecimalsKey, unitKey } = getSensorKeys('humidity');
                        const sensorData = { value: humidityDevice.humidity, unit: '%' };
                        dynamicSettings.push({
                            key: unitKey,
                            title: 'Unit',
                            type: 'string',
                            subgroup: 'humidity',
                            defaultValue: '%',
                            group,
                            immediate: true,
                            choices: ['%'],
                        });
                        dynamicSettings.push({
                            key: maxDecimalsKey,
                            title: 'Max Decimals',
                            type: 'number',
                            subgroup: 'humidity',
                            defaultValue: 1,
                            group,
                        });
                    }
                } else {
                    this.console.warn(`Device ${deviceId} not found`);
                }
            }
    
            dynamicSettings.push(
                {
                    key: parserStringKey,
                    title: 'Parser',
                    description: `String used to generate the content. Available variables: ${availableSensorIds.join(', ')}`,
                    type: 'textarea',
                    group,
                },
            );
        }
    
        this.storageSettings = await convertSettingsToStorageSettings({
            device: this,
            dynamicSettings,
            initStorage: this.initStorage
        });

    }
    
    async getSettings(): Promise<Setting[]> {
        return this.storageSettings.getSettings();
    }

    putSetting(key: string, value: SettingValue): Promise<void> {
        return this.storageSettings.putSetting(key, value);
    }

    async canMixin(type: ScryptedDeviceType, interfaces: string[]): Promise<string[]> {
        return interfaces.includes(ScryptedInterface.VideoTextOverlays) ?
            [
                ScryptedInterface.Settings,
            ] :
            undefined;
    }

    async getMixin(mixinDevice: DeviceBase, mixinDeviceInterfaces: ScryptedInterface[], mixinDeviceState: WritableDeviceState): Promise<any> {
        return new OsdManagerMixin(
            {
                mixinDevice,
                mixinDeviceInterfaces,
                mixinDeviceState,
                mixinProviderNativeId: this.nativeId,
                group: 'OSD manager',
                groupKey: osdManagerPrefix,
            },
            this);
    }

    async releaseMixin(id: string, mixinDevice: any): Promise<void> {
        await mixinDevice.release();
    }
}