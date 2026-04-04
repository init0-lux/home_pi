import express, { Request, Response, Router } from 'express';
import { getAllAppliances, createSchedule, getAllSchedules, getDueSchedules, markScheduleCompleted } from './database';
import { publishControl, isNodeOnline } from './mqtt';

const router: Router = express.Router();

// GET /api/appliances - Returns all appliance states as JSON
router.get('/appliances', async (req: Request, res: Response) => {
    try {
        const appliances = await getAllAppliances();
        res.json(appliances);
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/appliance/:id - Control appliance (Publish MQTT only)
router.post('/appliance/:id', (req: Request, res: Response) => {
    const idParam = req.params['id'];
    const id = parseInt(typeof idParam === 'string' ? idParam : '0');
    const { state } = req.body;

    if (isNaN(id) || (state !== 0 && state !== 1)) {
        return res.status(400).json({ error: 'Invalid id or state' });
    }

    publishControl(id, state);
    res.json({ success: true, message: 'Command published' });
});

// POST /api/schedule - Create schedule
router.post('/schedule', async (req: Request, res: Response) => {
    const { appliance_id, state, trigger_time } = req.body;

    if (!appliance_id || (state !== 0 && state !== 1) || !trigger_time) {
        return res.status(400).json({ error: 'Missing or invalid parameters' });
    }

    try {
        await createSchedule(appliance_id, state, trigger_time);
        res.json({ success: true, message: 'Schedule created' });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/schedules - Returns all schedules
router.get('/schedules', async (req: Request, res: Response) => {
    try {
        const schedules = await getAllSchedules();
        res.json(schedules);
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/node-status - For Optional Node indicator
router.get('/node-status', (req: Request, res: Response) => {
    res.json({ online: isNodeOnline() });
});

export default router;
