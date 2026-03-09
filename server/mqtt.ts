import mqtt from 'mqtt';
import { updateApplianceState } from './database';

const MQTT_BROKER = 'mqtt://localhost';
const client = mqtt.connect(MQTT_BROKER);

let nodeOnline = false;
let lastHeartbeat = 0;

interface ControlPayload {
    state: number;
    timestamp: number;
}

interface StatusPayload {
    state: number;
    updated_at: number;
}

interface NodeStatusPayload {
    online: boolean;
}

client.on('connect', () => {
    console.log('Connected to MQTT broker');

    // Subscribe to all appliance status topics
    client.subscribe('home/appliance/+/status', (err) => {
        if (err) console.error('Subscription error:', err);
    });

    // Subscribe to node status topic
    client.subscribe('home/node/status', (err) => {
        if (err) console.error('Subscription error:', err);
    });
});

client.on('message', (topic: string, message: Buffer) => {
    try {
        const payload: any = JSON.parse(message.toString());

        // Handle Appliance Status
        const applianceMatch = topic.match(/^home\/appliance\/(\d+)\/status$/);
        if (applianceMatch) {
            const id = parseInt(applianceMatch[1] || '0');
            const state = (payload as StatusPayload).state;
            updateApplianceState(id, state)
                .catch(err => console.error(`DB Update Error for appliance ${id}:`, err));
        }

        // Handle Node Status
        if (topic === 'home/node/status') {
            if ((payload as NodeStatusPayload).online) {
                nodeOnline = true;
                lastHeartbeat = Date.now();
            }
        }
    } catch (err) {
        console.error('Error parsing MQTT message:', err);
    }
});

export const publishControl = (id: number, state: number): void => {
    const topic = `home/appliance/${id}/set`;
    const payload: ControlPayload = {
        state: state,
        timestamp: Math.floor(Date.now() / 1000)
    };
    client.publish(topic, JSON.stringify(payload));
};

export const isNodeOnline = (): boolean => {
    // Offline if no heartbeat in 10 seconds
    if (Date.now() - lastHeartbeat > 10000) {
        nodeOnline = false;
    }
    return nodeOnline;
};

export default {
    publishControl,
    isNodeOnline
};
