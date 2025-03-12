import sdk, { EventListenerRegister, HumiditySensor, Lock, LockState, ObjectsDetected, ScryptedDeviceBase, ScryptedInterface, Sensors, TemperatureUnit, Thermometer, VideoTextOverlay } from "@scrypted/sdk";
import { StorageSetting, StorageSettings, StorageSettingsDevice, StorageSettingsDict } from "@scrypted/sdk/storage-settings";
import { UnitConverter } from '../../scrypted-homeassistant/src/unitConverter';
import { CameraType } from "./cameraMixin";
import OsdManagerProvider from "./main";

export const deviceFilter = `['${ScryptedInterface.Thermometer}','${ScryptedInterface.HumiditySensor}','${ScryptedInterface.Lock}','${ScryptedInterface.EntrySensor}','${ScryptedInterface.BinarySensor}','${ScryptedInterface.Sensors}'].some(elem => interfaces.includes(elem))`;
export const pluginEnabledFilter = `interfaces.includes('${ScryptedInterface.VideoTextOverlays}')`;
export const osdManagerPrefix = 'osdManager';

export type CameraOverlay = VideoTextOverlay & { id: string };
export type SupportedDevice = ScryptedDeviceBase & (Thermometer | HumiditySensor | Lock) & Sensors;
export enum OverlayType {
    Disabled = 'Disabled',
    Text = 'Text',
    Device = 'Device',
    Template = 'Template',
    FaceDetection = 'FaceDetection',
    BatteryLeft = 'BatteryLeft',
}

export interface Overlay {
    currentText: string;
    text: string;
    type: OverlayType;
    device: string;
    regex: string;
    maxCharacters?: number;
    maxDecimals: number;
    unit?: string;
    sensorId?: string;
    sensorName?: string;
    template?: string;
}

export enum ListenerType {
    Face = 'Face',
    Humidity = 'Humidity',
    Temperature = 'Temperature',
    Lock = 'Lock',
    Battery = 'Battery',
    Sleep = 'Sleep',
    Entry = 'Entry',
    Sensors = 'Sensors',
    Interval = 'Interval',
    Binary = 'Binary',
}

export const getFriendlyTitle = (props: {
    rawTitle: string,
    device: CameraType,
}) => {
    const { device, rawTitle } = props;
    if (device.pluginId === '@scrypted/amcrest') {
        return rawTitle
            .replace(/^table\.VideoWidget\[\d+\]\./, '');
    } else {
        return `Overlay ${rawTitle}`;
    }
}

export const getTemplateKeys = (templateId: string) => {
    const group = `Template: ${templateId}`;
    const devicesKey = `template:${templateId}:devices`;
    const scriptKey = `template:${templateId}:script`;
    const parserStringKey = `template:${templateId}:parserString`;
    const getDeviceKeys = (deviceId: string) => {
        const sensorsKey = `overlay:${templateId}:${deviceId}:sensors`;

        return {
            sensorsKey,
        };
    };
    const getSensorKeys = (sensorId: string) => {
        const maxDecimalsKey = `overlay:${templateId}:${sensorId}:maxDecimals`;
        const unitKey = `overlay:${templateId}:${sensorId}:unit`;

        return {
            maxDecimalsKey,
            unitKey,
        };
    };

    return {
        group,
        devicesKey,
        scriptKey,
        parserStringKey,
        getSensorKeys,
        getDeviceKeys,
    }
}

export const getOverlayKeys = (overlayId: string) => {
    const currentTextKey = `overlay:${overlayId}:currentText`;
    const textKey = `overlay:${overlayId}:text`;
    const typeKey = `overlay:${overlayId}:type`;
    const regexKey = `overlay:${overlayId}:regex`;
    const deviceKey = `overlay:${overlayId}:device`;
    const templateKey = `overlay:${overlayId}:template`;
    const maxCharactersKey = `overlay:${overlayId}:maxCharacters`;
    const maxDecimalsKey = `overlay:${overlayId}:maxDecimals`;
    const sensorIdKey = `overlay:${overlayId}:sensorId`;
    const sensorNameKey = `overlay:${overlayId}:sensorName`;
    const unitKey = `overlay:${overlayId}:unit`;

    return {
        currentTextKey,
        textKey,
        typeKey,
        regexKey,
        deviceKey,
        maxCharactersKey,
        maxDecimalsKey,
        sensorIdKey,
        sensorNameKey,
        templateKey,
        unitKey,
    }
}

export const getOverlaySettings = (props: {
    storage: StorageSettings<any>,
    overlays: CameraOverlay[],
    templates: string[],
    logger: Console,
    device: CameraType,
    onSettingUpdated: () => Promise<void>
}) => {
    const { storage, templates, overlays, device, onSettingUpdated, logger } = props;
    const settings: StorageSetting[] = [];

    for (const overlay of overlays) {
        const rawTitle = `${overlay.id}`;
        const friendlyTitle = getFriendlyTitle({
            rawTitle,
            device,
        });
        const overlayName = friendlyTitle;

        const {
            deviceKey,
            typeKey,
            regexKey,
            textKey,
            maxCharactersKey,
            maxDecimalsKey,
            sensorNameKey,
            unitKey,
            templateKey,
        } = getOverlayKeys(overlay.id);

        if (overlay.readonly) {
            settings.push(
                {
                    title: 'Readonly',
                    type: 'boolean',
                    subgroup: overlayName,
                    value: true,
                    readonly: true,
                }
            );

            continue;
        }

        const type = storage.getItem(typeKey) ?? OverlayType.Text;

        settings.push(
            {
                key: typeKey,
                title: 'Overlay Type',
                type: 'string',
                choices: Object.values(OverlayType),
                defaultValue: OverlayType.Text,
                subgroup: overlayName,
                immediate: true,
                onPut: onSettingUpdated
            },
            {
                key: maxCharactersKey,
                title: 'Max Characters',
                type: 'number',
                subgroup: overlayName,
                onPut: onSettingUpdated
            }
        );

        if (type === OverlayType.Disabled) {
            continue;
        }

        if (type === OverlayType.Template) {
            settings.push(
                {
                    key: templateKey,
                    title: 'Template',
                    type: 'string',
                    subgroup: overlayName,
                    immediate: true,
                    choices: templates,
                    onPut: onSettingUpdated
                },
            );
            continue;
        }

        if (type === OverlayType.Text) {
            settings.push({
                key: textKey,
                title: 'Text',
                type: 'string',
                subgroup: overlayName,
                onPut: onSettingUpdated
            })
        };

        const regexSetting: StorageSetting = {
            key: regexKey,
            title: 'Value Regex',
            description: 'Expression to generate the text. ${value} contains the value and ${unit} the unit',
            type: 'string',
            subgroup: overlayName,
            placeholder: '${value} ${unit}',
            defaultValue: '${value} ${unit}',
            onPut: onSettingUpdated
        };
        const precisionSetting: StorageSetting = {
            key: maxDecimalsKey,
            title: 'Max Decimals',
            type: 'number',
            subgroup: overlayName,
            defaultValue: 1,
            onPut: onSettingUpdated
        };

        if (type === OverlayType.Device) {
            settings.push(
                {
                    key: deviceKey,
                    title: 'Device',
                    type: 'device',
                    subgroup: overlayName,
                    deviceFilter,
                    immediate: true,
                    onPut: onSettingUpdated
                },
            );

            const selectedDevice = storage.getItem(deviceKey) as ScryptedDeviceBase | string;
            const selectedDeviceId = typeof selectedDevice === 'string' ? selectedDevice : selectedDevice?.id;
            const actualDevice = selectedDeviceId ? sdk.systemManager.getDeviceById<ScryptedDeviceBase & Sensors>(selectedDeviceId) : undefined;

            if (actualDevice?.interfaces.includes(ScryptedInterface.Sensors)) {
                const sensors = Object.entries(actualDevice.sensors ?? {});
                const sensorNames = sensors.map(([_, item]) => item.name).sort();
                settings.push(
                    {
                        key: sensorNameKey,
                        title: 'Sensor',
                        type: 'string',
                        subgroup: overlayName,
                        immediate: true,
                        choices: sensorNames,
                        onPut: onSettingUpdated
                    },
                );

                const selectedSensorName = storage.getItem(sensorNameKey) as string;
                if (selectedSensorName) {
                    const sensorFound = sensors.find(([_, { name }]) => name === selectedSensorName);
                    if (sensorFound) {
                        const { unit } = sensorFound[1];
                        const possibleUnits = UnitConverter.getUnits(unit);
                        settings.push(
                            {
                                key: unitKey,
                                title: 'Unit',
                                type: 'string',
                                subgroup: overlayName,
                                immediate: true,
                                choices: possibleUnits,
                                onPut: onSettingUpdated
                            }
                        );
                    }
                }
            }

            settings.push(
                regexSetting,
                precisionSetting,
            );
        } else if (type === OverlayType.FaceDetection) {
            settings.push(regexSetting);
        } else if (type === OverlayType.BatteryLeft) {
            settings.push(regexSetting, precisionSetting);
        }
    }

    return settings;
}

export const getOverlay = (props: {
    storageSettings: StorageSettings<string>,
    overlayId: string
}): Overlay => {
    const { storageSettings, overlayId } = props;

    const {
        currentTextKey,
        deviceKey,
        typeKey,
        regexKey,
        textKey,
        maxCharactersKey,
        maxDecimalsKey,
        sensorIdKey,
        sensorNameKey,
        unitKey,
        templateKey,
    } = getOverlayKeys(overlayId);

    const currentText = storageSettings.values[currentTextKey];
    const type = storageSettings.values[typeKey];
    const device = storageSettings.values[deviceKey]?.id;
    const text = storageSettings.values[textKey];
    const regex = storageSettings.values[regexKey];
    const maxCharacters = storageSettings.values[maxCharactersKey];
    const maxDecimals = storageSettings.values[maxDecimalsKey];
    const sensorId = storageSettings.values[sensorIdKey];
    const sensorName = storageSettings.values[sensorNameKey];
    const unit = storageSettings.values[unitKey];
    const template = storageSettings.values[templateKey];

    return {
        currentText,
        device,
        type,
        regex,
        text,
        maxCharacters,
        maxDecimals,
        sensorId,
        sensorName,
        unit,
        template,
    };
}

export const formatValue = (value: any, maxDecimals: number) => {
    const factor = Math.pow(10, maxDecimals);
    return Math.floor(Number(value ?? 0) * factor) / factor;
};

export const getEntryText = (data: any, plugin: OsdManagerProvider): string => {
    return data === 'jammed'
        ? plugin.storageSettings.values.jammedText
        : (data ? plugin.storageSettings.values.openText : plugin.storageSettings.values.closedText);
};

export const getBinaryText = (data: any, plugin: OsdManagerProvider): string => {
    return data ? plugin.storageSettings.values.openText : plugin.storageSettings.values.closedText;
};

export const getLockText = (data: any, plugin: OsdManagerProvider): string => {
    return data === 'jammed'
        ? plugin.storageSettings.values.jammedText
        : (data === LockState.Locked ? plugin.storageSettings.values.lockText : plugin.storageSettings.values.unlockText);
};

export const parseOverlayData = (props: {
    listenerType: ListenerType,
    data: any,
    overlay: Overlay,
    plugin: OsdManagerProvider,
    logger: Console,
}) => {
    const { listenerType, data, overlay, plugin } = props;
    const { regex, text, device, maxDecimals } = overlay;
    const realDevice = device ? sdk.systemManager.getDeviceById<SupportedDevice>(device) : undefined;

    let value;
    let unit;
    let textToUpdate;
    if (listenerType === ListenerType.Face) {
        value = (data as ObjectsDetected)?.detections?.find(det => det.className === 'face')?.label;
    } else if (listenerType === ListenerType.Temperature) {
        unit = realDevice.temperatureUnit ?? TemperatureUnit.C;

        value = data;
        if (unit === TemperatureUnit.F) {
            value = data * 9 / 5 + 32;
        }

        value = formatValue(value, maxDecimals);
    } else if (listenerType === ListenerType.Humidity) {
        value = formatValue(data, maxDecimals);
        unit = '%';
    } else if (listenerType === ListenerType.Battery) {
        value = formatValue(data, maxDecimals);
        unit = '%';
    } else if (listenerType === ListenerType.Lock) {
        value = getLockText(data, plugin);
    } else if (listenerType === ListenerType.Entry) {
        value = getEntryText(data, plugin);
    } else if (listenerType === ListenerType.Binary) {
        value = getBinaryText(data, plugin);
    } else if (listenerType === ListenerType.Sensors) {
        if (typeof data === 'number') {
            unit = overlay.unit;
            value = formatValue(UnitConverter.siToLocal(data, unit), maxDecimals);
        }
        else {
            unit = overlay.unit ?? data?.unit;
            const localValue = UnitConverter.siToLocal(data?.value, unit);
            value = formatValue(localValue, maxDecimals);
        }
    } else if (overlay.type === OverlayType.Text) {
        textToUpdate = text;
    }


    if (value != undefined && regex) {
        textToUpdate = regex
            .replace('${value}', value ?? '')
            .replace('${unit}', unit ?? '');
    }

    return { textToUpdate, value };
}

export const convertSettingsToStorageSettings = async (props: {
    device: StorageSettingsDevice,
    dynamicSettings: StorageSetting[],
    initStorage: StorageSettingsDict<string>
}) => {
    const { device, dynamicSettings, initStorage } = props;

    const onPutToRestore: Record<string, any> = {};
    Object.entries(initStorage).forEach(([key, setting]) => {
        if (setting.onPut) {
            onPutToRestore[key] = setting.onPut;
        }
    });

    const settings: StorageSetting[] = await new StorageSettings(device, initStorage).getSettings();

    settings.push(...dynamicSettings);

    const deviceSettings: StorageSettingsDict<string> = {};

    for (const setting of settings) {
        const { value, key, onPut, ...rest } = setting;
        deviceSettings[key] = {
            ...rest,
            value: rest.type === 'html' ? value : undefined
        };
        if (setting.onPut) {
            deviceSettings[key].onPut = setting.onPut.bind(device)
        }
    }

    const updateStorageSettings = new StorageSettings(device, deviceSettings);

    Object.entries(onPutToRestore).forEach(([key, onPut]) => {
        updateStorageSettings.settings[key].onPut = onPut;
    });

    return updateStorageSettings;
}

export function getStrippedNativeId(device: ScryptedDeviceBase): string {
    const parts = device.nativeId.split(':');
    return parts.length > 1 ? parts[1] : parts[0];
}