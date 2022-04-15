import Debug from 'debug';
import { loadEmployees } from "./employee.js";
import { loadEmployeeEntry, loadEmployeeLatestEntry, saveEntry, saveEntryAction, saveNewEntry } from "./entry.js";
import { CLOCK_COMMENT_ACTION, CLOCK_IN_ACTION, CLOCK_OUT_ACTION, ENTRY_TYPES } from "./settings.js";
const debug = Debug('chums:lib:time-clock:clock-actions');
const WARNING_CLOCKED_IN = 'Currently clocked in or missing previous clock out action';
const WARNING_CLOCKED_OUT = 'Currently clocked out or missing previous clock in action';
const WARNING_ENTRY_NOT_FOUND = 'Entry not found.';
const CLOCK_OUT_ERROR = "Your 'clock out' action failed";
const CLOCK_IN_ERROR = "Your 'clock in' action failed";
const LOGIN_ERROR = 'Invalid Login Code';
function clockActionError(reason) {
    const error = new Error(reason);
    error.name = 'ClockActionError';
    return error;
}
async function loadClockActionEmployee(loginCode) {
    try {
        if (!loginCode) {
            return Promise.reject(clockActionError(LOGIN_ERROR));
        }
        const [employee] = await loadEmployees({ loginCode });
        if (!employee) {
            return Promise.reject(clockActionError(LOGIN_ERROR));
        }
        return employee;
    }
    catch (err) {
        if (err instanceof Error) {
            debug("loadClockActionEmployee()", err.message);
            return Promise.reject(err);
        }
        debug("loadClockActionEmployee()", err);
        return Promise.reject(clockActionError('Error in loadClockActionEmployee()'));
    }
}
async function clockInHandler(loginCode, options) {
    try {
        const override = options.override;
        const idUser = options.userId || 0;
        const entryDate = options.entryDate || new Date();
        const employee = await loadClockActionEmployee(loginCode);
        const existing = await loadEmployeeLatestEntry({ idEmployee: employee.id });
        if (existing?.isClockedIn && !override) {
            return { existing, warning: WARNING_CLOCKED_IN };
        }
        const newEntry = await saveNewEntry({
            idEmployee: employee.id,
            idUser,
            idEntryType: ENTRY_TYPES.TIMECLOCK,
            EntryDate: entryDate,
            Duration: 0,
            Note: options.notes || '',
        });
        const action = await saveEntryAction({
            idEntry: newEntry.id,
            actionType: CLOCK_IN_ACTION,
            time: entryDate,
            ip: options.ip,
            notes: options || {},
        });
        const entry = await loadEmployeeEntry({ idEmployee: employee.id, id: newEntry.id });
        const warning = !entry ? 'Clock Entry not found' : undefined;
        return { entry, warning };
    }
    catch (err) {
        if (err instanceof Error) {
            debug("clockInHandler()", err.message);
            return Promise.reject(err);
        }
        debug("clockInHandler()", err);
        return Promise.reject(new Error('Error in clockInHandler()'));
    }
}
async function adjustClockHandler({ idEmployee, idEntry, idUser, action, comment }) {
    try {
        const existing = await loadEmployeeEntry({ idEmployee, id: idEntry });
        if (!existing) {
            if ((action.actionType & CLOCK_IN_ACTION) === CLOCK_IN_ACTION) {
                const newEntry = await saveNewEntry({
                    idEmployee,
                    idEntryType: ENTRY_TYPES.TIMECLOCK,
                    EntryDate: action.time,
                    idUser,
                    Duration: 0,
                    Note: comment || ''
                });
                await saveEntryAction({
                    ...action,
                    idEntry: newEntry.id,
                });
                const entry = await loadEmployeeEntry({ idEmployee, id: newEntry.id });
                return { entry };
            }
            return { warning: WARNING_ENTRY_NOT_FOUND };
        }
        if (comment) {
            existing.Note = [existing.Note, comment].filter(val => !!val).join('; ');
            await saveEntry(existing);
        }
        await saveEntryAction(action);
        const entry = await loadEmployeeEntry({ idEmployee, id: idEntry });
        return { entry };
    }
    catch (err) {
        if (err instanceof Error) {
            debug("adjustClockInHandler()", err.message);
            return Promise.reject(err);
        }
        debug("adjustClockInHandler()", err);
        return Promise.reject(new Error('Error in adjustClockInHandler()'));
    }
}
async function clockOutHandler(loginCode, options) {
    try {
        const override = options.override;
        const idUser = options.userId || 0;
        const entryDate = options.entryDate || new Date();
        const employee = await loadClockActionEmployee(loginCode);
        let existing = options?.idEntry
            ? await loadEmployeeEntry({ idEmployee: employee.id, id: options.idEntry })
            : await loadEmployeeLatestEntry({ idEmployee: employee.id });
        if (!existing || !existing.isClockedIn) {
            if (override) {
                const _entry = await saveNewEntry({
                    idEmployee: employee.id,
                    idUser,
                    idEntryType: ENTRY_TYPES.TIMECLOCK,
                    EntryDate: entryDate,
                    Duration: 0,
                    Note: options.notes || '',
                });
                await saveEntryAction({
                    idEntry: _entry.id,
                    actionType: CLOCK_OUT_ACTION,
                    time: entryDate,
                    ip: options.ip,
                    notes: options || {},
                });
                const entry = await loadEmployeeEntry({ idEmployee: employee.id, id: _entry.id });
                const warning = !entry ? 'Clock Entry not found' : undefined;
                return { entry, warning };
            }
            if (existing) {
                return { existing, warning: WARNING_CLOCKED_OUT };
            }
            return Promise.reject(clockActionError('Clock out failed. You are not clocked in.'));
        }
        await saveEntryAction({
            idEntry: existing.id,
            actionType: CLOCK_OUT_ACTION,
            time: entryDate,
            ip: options.ip || '',
            notes: options || {},
        });
        const entry = await loadEmployeeEntry({ idEmployee: employee.id, id: existing.id });
        const warning = !entry ? 'Clock Entry not found' : undefined;
        return { entry, warning };
    }
    catch (err) {
        if (err instanceof Error) {
            debug("clockOutHandler()", err.message);
            return Promise.reject(err);
        }
        debug("clockOutHandler()", err);
        return Promise.reject(new Error('Error in clockOutHandler()'));
    }
}
export async function deleteClockEntry({ idEmployee, idEntry, idUser, action, comment }) {
    try {
        const existing = await loadEmployeeEntry({ idEmployee, id: idEntry });
        if (!existing) {
            return Promise.reject(new Error('Clock entry not found'));
        }
        await saveEntryAction({
            ...action,
            idEntry: existing.id,
        });
        await saveEntry({
            ...existing,
            Note: [existing.Note, comment].filter(val => !!val).join(';'),
            deleted: true,
            deletedBy: idUser,
        });
        const entry = await loadEmployeeEntry({ idEmployee: idEmployee, id: existing.id });
        const warning = !entry ? 'Clock Entry not found' : undefined;
        return { entry, warning };
    }
    catch (err) {
        if (err instanceof Error) {
            debug("deleteClockEntry()", err.message);
            return Promise.reject(err);
        }
        debug("deleteClockEntry()", err);
        return Promise.reject(new Error('Error in deleteClockEntry()'));
    }
}
export const postClockIn = async (req, res) => {
    try {
        const { loginCode, override } = req.body;
        const result = await clockInHandler(loginCode, { override, ip: req.ip, userId: res.locals.profile?.user?.id });
        res.json(result);
    }
    catch (err) {
        if (err instanceof Error) {
            debug("postClockIn()", err.message);
            return res.json({ error: err.message, name: err.name });
        }
        res.json({ error: 'unknown error in postClockIn' });
    }
};
export const postClockOut = async (req, res) => {
    try {
        const { loginCode, override, idEntry, notes } = req.body;
        const result = await clockOutHandler(loginCode, { override, idEntry, notes, ip: req.ip, userId: res.locals.profile?.user?.id || 0 });
        res.json(result);
    }
    catch (err) {
        if (err instanceof Error) {
            debug("postClockOut()", err.message);
            return res.json({ error: err.message, name: err.name });
        }
        res.json({ error: 'unknown error in postClockOut' });
    }
};
export const postAdjustClock = async (req, res) => {
    try {
        const { action, comment } = req.body;
        const { idEntry, idEmployee } = req.params;
        const idUser = res.locals.profile?.user?.id;
        const [employee] = await loadEmployees({ userId: idUser, idEmployee: idEmployee });
        if (!employee) {
            return res.json({ warning: 'Employee not found' });
        }
        const result = await adjustClockHandler({ idEmployee: employee.id, idEntry, action, idUser, comment });
        res.json({ result });
    }
    catch (err) {
        if (err instanceof Error) {
            debug("postAdjustClock()", err.message);
            return Promise.reject(err);
        }
        debug("postAdjustClock()", err);
        return Promise.reject(new Error('Error in postAdjustClock()'));
    }
};
export const deleteEntry = async (req, res) => {
    try {
        const { idEntry, idEmployee } = req.params;
        const idUser = res.locals.profile?.user?.id;
        const { comment } = req.body;
        const [employee] = await loadEmployees({ userId: idUser, idEmployee: idEmployee });
        if (!employee) {
            return res.json({ warning: 'Employee not found' });
        }
        const action = {
            idEntry: +idEntry,
            actionType: CLOCK_COMMENT_ACTION,
            ip: req.ip,
            notes: { url: req.originalUrl, body: req.body },
            time: new Date(),
        };
        const result = await deleteClockEntry({ idEmployee: employee.id, idEntry, action, idUser, comment });
        res.json({ result });
    }
    catch (err) {
        if (err instanceof Error) {
            debug("deleteEntry()", err.message);
            return res.json({ error: err.message, name: err.name });
        }
        res.json({ error: 'unknown error in deleteEntry' });
    }
};
