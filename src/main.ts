import sdk, { Settings, DeviceBase, MixinProvider, ScryptedDeviceBase, ScryptedDeviceType, ScryptedInterface, WritableDeviceState, Setting, SettingValue, DeviceInformation, Sensors } from "@scrypted/sdk";
import OsdManagerMixin from "./cameraMixin";
import { convertSettingsToStorageSettings, deviceFilter, getTemplateKeys, osdManagerPrefix, SupportedDevice } from "./utils";
import { StorageSetting, StorageSettings, StorageSettingsDict } from "@scrypted/sdk/storage-settings";
import { template } from "lodash";
import { UnitConverter } from "../../scrypted-homeassistant/src/unitConverter";

export default class OsdManagerProvider extends ScryptedDeviceBase implements MixinProvider, Settings {
    initStorage: StorageSettingsDict<string> = {
        lockText: {
            title: 'Text to show for Locked state',
            type: 'string',
            defaultValue: 'Locked',
        },
        unlockText: {
            title: 'Text to show for Unlocked state',
            type: 'string',
            defaultValue: 'Unlocked',
        },
        openText: {
            title: 'Text to show for Open state',
            type: 'string',
            defaultValue: 'Open',
        },
        closedText: {
            title: 'Text to show for Closed state',
            type: 'string',
            defaultValue: 'Closed',
        },
        templates: {
            title: 'Templates',
            description: 'Define templates from multiple devices',
            type: 'string',
            multiple: true,
            defaultValue: [],
            choices: [],
            combobox: true,
            onPut: this.refreshSettings
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
                const device = sdk.systemManager.getDeviceById<Sensors>(deviceId);

                const { sensorsKey } = getDeviceKeys(deviceId);
                const selectedSensorIds = JSON.parse(this.storage.getItem(sensorsKey) ?? '[]');

                const sensorIds = Object.keys(device.sensors);

                dynamicSettings.push(
                    {
                        key: sensorsKey,
                        title: `Available sensors on device "${device.name}"`,
                        description: `Select the sensors to make available on the template. Access it on the parser with "{${deviceId}.sensorName}"`,
                        type: 'string',
                        group,
                        choices: sensorIds,
                        immediate: true,
                        combobox: true,
                        multiple: true,
                        onPut: this.refreshSettings
                    },
                );

                for (const sensorId of selectedSensorIds) {
                    availableSensorIds.push(`{${device.id}.${sensorId}}`);

                    const { maxDecimalsKey, unitKey } = getSensorKeys(sensorId);
                    const sensorData = device.sensors[sensorId]

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
                        },
                    );
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