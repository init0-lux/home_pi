import sqlite3 from 'sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

// Define Interfaces
export interface Appliance {
    id: number;
    state: number;
    last_updated: number;
}

export interface Schedule {
    id: number;
    appliance_id: number;
    target_state: number;
    trigger_time: number;
    status: 'pending' | 'completed' | 'failed';
}

const dbPath = path.resolve(__dirname, '../database/automation.db');

const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Error opening database', err.message);
    } else {
        console.log('Connected to SQLite database.');
        initializeDatabase();
    }
});

function initializeDatabase(): void {
    db.serialize(() => {
        // Appliances Table
        db.run(`CREATE TABLE IF NOT EXISTS appliances (
            id INTEGER PRIMARY KEY,
            state INTEGER NOT NULL,
            last_updated INTEGER
        )`);

        // Schedules Table
        db.run(`CREATE TABLE IF NOT EXISTS schedules (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            appliance_id INTEGER,
            target_state INTEGER,
            trigger_time INTEGER,
            status TEXT DEFAULT 'pending'
        )`);

        // Migration: Add status column if it doesn't exist (for existing databases)
        db.run(`ALTER TABLE schedules ADD COLUMN status TEXT DEFAULT 'pending'`, (err) => {
            if (err) {
                // Ignore error if column already exists
                if (!err.message.includes("duplicate column name")) {
                    console.error("Migration Error:", err.message);
                }
            } else {
                console.log("Migration: Added status column to schedules table.");
            }
        });

        // Prepopulate appliances if empty
        db.get("SELECT COUNT(*) as count FROM appliances", (err, row: any) => {
            if (row && row.count === 0) {
                const stmt = db.prepare("INSERT INTO appliances (id, state, last_updated) VALUES (?, 0, ?)");
                const now = Math.floor(Date.now() / 1000);
                for (let i = 1; i <= 4; i++) {
                    stmt.run(i, now);
                }
                stmt.finalize();
                console.log("Prepopulated appliances table with 4 rows.");
            }
        });
    });
}

export const getAllAppliances = (): Promise<Appliance[]> => {
    return new Promise((resolve, reject) => {
        db.all("SELECT * FROM appliances", [], (err, rows: Appliance[]) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });
};

export const updateApplianceState = (id: number, state: number): Promise<void> => {
    const now = Math.floor(Date.now() / 1000);
    return new Promise((resolve, reject) => {
        db.run("UPDATE appliances SET state = ?, last_updated = ? WHERE id = ?", [state, now, id], (err) => {
            if (err) reject(err);
            else resolve();
        });
    });
};

export const getDueSchedules = (currentTime: number): Promise<Schedule[]> => {
    return new Promise((resolve, reject) => {
        db.all("SELECT * FROM schedules WHERE trigger_time <= ? AND status = 'pending'", [currentTime], (err, rows: Schedule[]) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });
};

export const markScheduleCompleted = (id: number): Promise<void> => {
    return new Promise((resolve, reject) => {
        db.run("UPDATE schedules SET status = 'completed' WHERE id = ?", [id], (err) => {
            if (err) reject(err);
            else resolve();
        });
    });
};

export const getAllSchedules = (): Promise<Schedule[]> => {
    return new Promise((resolve, reject) => {
        db.all("SELECT * FROM schedules ORDER BY trigger_time DESC", [], (err, rows: Schedule[]) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });
};

export const deleteSchedule = (id: number): Promise<void> => {
    return new Promise((resolve, reject) => {
        db.run("DELETE FROM schedules WHERE id = ?", [id], (err) => {
            if (err) reject(err);
            else resolve();
        });
    });
};

export const createSchedule = (appliance_id: number, target_state: number, trigger_time: number): Promise<void> => {
    return new Promise((resolve, reject) => {
        db.run("INSERT INTO schedules (appliance_id, target_state, trigger_time, status) VALUES (?, ?, ?, 'pending')",
            [appliance_id, target_state, trigger_time], (err) => {
                if (err) reject(err);
                else resolve();
            });
    });
};

export default {
    getAllAppliances,
    updateApplianceState,
    getDueSchedules,
    deleteSchedule,
    markScheduleCompleted,
    createSchedule,
    getAllSchedules
};
