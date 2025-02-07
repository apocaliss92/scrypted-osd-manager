import { DeviceBase, MixinProvider, ScryptedDeviceBase, ScryptedDeviceType, ScryptedInterface, WritableDeviceState } from "@scrypted/sdk";
import OsdManagerMixin from "./cameraMixin";
import { osdManagerPrefix } from "./utils";

export default class OsdManagerProvider extends ScryptedDeviceBase implements MixinProvider {
    public mixinsMap: Record<string, OsdManagerMixin> = {};

    constructor(nativeId: string) {
        super(nativeId);
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