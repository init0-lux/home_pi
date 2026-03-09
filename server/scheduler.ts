import { getDueSchedules, markScheduleCompleted } from './database';
import { publishControl } from './mqtt';

export const startScheduler = (): void => {
    setInterval(async () => {
        const currentTime = Math.floor(Date.now() / 1000);

        try {
            const dueSchedules = await getDueSchedules(currentTime);

            for (const schedule of dueSchedules) {
                console.log(`Executing schedule ${schedule.id} for appliance ${schedule.appliance_id} -> ${schedule.target_state}`);

                // Publish MQTT command
                publishControl(schedule.appliance_id, schedule.target_state);

                // Mark schedule as completed after execution
                await markScheduleCompleted(schedule.id);
            }
        } catch (err) {
            console.error('Scheduler Error:', err);
        }
    }, 1000); // 1-second precision
};

export default { startScheduler };
