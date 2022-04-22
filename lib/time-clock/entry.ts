import Debug from 'debug';
import {mysql2Pool} from 'chums-local-modules';
import {AdjustClockProps, BaseEntry, BaseEntryAction, ClockActionResult, Entry, EntryAction} from "../types";
import {ResultSetHeader, RowDataPacket} from "mysql2";
import {changeRequiresApproval, entrySorter, isClockedIn, parseWeekTotals, validateEntries} from "./utils.js";
import {defaultAutoEntry, ENTRY_TYPES, STD_HOURS} from "./constants.js";
import {loadEmployees} from "./employee.js";
import {loadPayPeriods} from "./pay-periods.js";


const debug = Debug('chums:lib:time-clock:entry');
const API_USER_ID = Number(process.env.API_USER_ID || 0);


interface EntryActionRow extends EntryAction, RowDataPacket {
}

export async function loadEntryActions(idEntryList: number[] = []): Promise<EntryAction[]> {
    try {
        if (Array.isArray(idEntryList) === false || idEntryList.length === 0) {
            return [];
        }
        const query = `SELECT id,
                              idEntry,
                              type                AS actionType,
                              FROM_UNIXTIME(time) AS time,
                              ip,
                              notes,
                              timestamp
                       FROM timeclock.EntryAction
                       WHERE idEntry IN (:idEntryList)
                       ORDER BY id`;
        const params = {idEntryList};

        const [rows] = await mysql2Pool.query<EntryActionRow[]>(query, params);
        return rows.map(row => {
            return {
                ...row,
                notes: typeof row.notes === 'string' ? JSON.parse(row.notes || '{}') : row.notes
            }
        });
    } catch (err: unknown) {
        if (err instanceof Error) {
            debug("loadEntryActions()", err.message);
            return Promise.reject(err);
        }
        return Promise.reject(new Error('Unknown error in loadEntryActions()'));
    }
}

interface EntryRow extends Entry, RowDataPacket {
}

interface LoadEntryProps {
    idEmployee: string | number,
    id?: string | number,
    idEntryType?: string | number,
    idUser?: number
}

export async function loadEmployeeEntry({idEmployee, id}: LoadEntryProps): Promise<Entry | null> {
    try {
        if (id === 0) {
            return null;
        }
        if (!id || !+id) {
            return Promise.reject(new Error('Invalid entry ID'));
        }
        const [entry] = await loadEntries(idEmployee, [Number(id)]);
        return entry || null;
    } catch (err: unknown) {
        if (err instanceof Error) {
            debug("loadEmployeeEntry()", err.message);
            return Promise.reject(err);
        }
        debug("loadEmployeeEntry()", err);
        return Promise.reject(new Error('Error in loadEmployeeEntry()'));
    }
}


interface LatestEntryRow extends RowDataPacket {
    id: number,
}

export async function loadEmployeeLatestEntry({
                                                  idEmployee,
                                                  idEntryType = ENTRY_TYPES.TIMECLOCK
                                              }: LoadEntryProps): Promise<Entry | null> {
    try {
        const query = `SELECT e.id
                       FROM timeclock.Entry e
                            INNER JOIN (
                                       SELECT MIN(StartDate) AS StartDate,
                                              MAX(EndDate)   AS EndDate
                                       FROM timeclock.PayPeriods
                                       WHERE completed = 0
                                         AND StartDate < UNIX_TIMESTAMP()) payPeriods
                                       ON e.EntryDate BETWEEN payPeriods.StartDate
                                           AND payPeriods.EndDate
                       WHERE deleted = 0
                         AND idEmployee = :idEmployee
                         AND idEntryType = :idEntryType
                         AND EntryDate < UNIX_TIMESTAMP()
                       ORDER BY EntryDate DESC
                       LIMIT 1`;
        const params = {idEmployee, idEntryType};
        const [rows] = await mysql2Pool.query<LatestEntryRow[]>(query, params);
        if (!rows.length) {
            return null;
        }
        const {id} = rows[0];
        const [entry] = await loadEntries(idEmployee, [id]);
        return entry;
    } catch (err: unknown) {
        if (err instanceof Error) {
            debug("loadEmployeeLatestEntry()", err.message);
            return Promise.reject(err);
        }
        return Promise.reject(new Error('loadEmployeeLatestEntry()'));
    }
}


export async function saveEntryAction(entryAction: BaseEntryAction): Promise<EntryAction> {
    try {
        const {idEntry, actionType, time, ip, notes} = entryAction;
        const sql = `INSERT INTO timeclock.EntryAction(idEntry, type, time, ip, notes)
                     VALUES (:idEntry, :actionType, UNIX_TIMESTAMP(:time), :ip, :notes)`;
        const args = {idEntry, actionType, time, ip, notes: JSON.stringify(notes || {})};
        const [result] = await mysql2Pool.query<ResultSetHeader>(sql, args);
        const [action] = await loadEntryActions([result.insertId]);
        return action;
    } catch (err: unknown) {
        if (err instanceof Error) {
            debug("saveEntryAction()", err.message);
            return Promise.reject(err);
        }
        return Promise.reject(new Error('saveEntryAction()'));
    }
}


export async function saveNewEntry(entry: BaseEntry): Promise<Entry> {
    try {
        if (!entry.idEmployee) {
            return Promise.reject(new Error('Invalid employee'));
        }
        if (!entry.EntryDate) {
            entry.EntryDate = new Date().toISOString();
        }

        const {idEmployee, idEntryType, idUser, EntryDate, Duration, Note} = entry;
        const query = `INSERT INTO timeclock.Entry (idEmployee,
                                                    idEntryType,
                                                    idUser,
                                                    EntryDate,
                                                    Duration,
                                                    Note,
                                                    idPayPeriod)
                       VALUES (:idEmployee,
                               :idEntryType,
                               :idUser,
                               UNIX_TIMESTAMP(:EntryDate),
                               :Duration,
                               :Note,
                               (
                               SELECT id
                               FROM timeclock.PayPeriods
                               WHERE UNIX_TIMESTAMP(:EntryDate) BETWEEN StartDate AND EndDate))`;
        const args = {idEmployee, idEntryType, EntryDate, idUser, Duration, Note}
        const [result] = await mysql2Pool.query<ResultSetHeader>(query, args);
        const [_entry] = await loadEntries(idEmployee, [result.insertId], true);
        await employeeApproveEntries(entry.idEmployee, _entry.idPayPeriod, false);
        await supervisorApproveEntries(entry.idEmployee, _entry.idPayPeriod, 0, false);
        if (_entry.idEntryType !== ENTRY_TYPES.AUTOMATIC) {
            await autoGenerateSalaryEntries(_entry.idEmployee, _entry.idPayPeriod);
        }

        return _entry;
    } catch (err: unknown) {
        if (err instanceof Error) {
            debug("clockIn()", err.message);
            return Promise.reject(err);
        }
        return Promise.reject(new Error('saveNewEntry()'));
    }
}

export async function saveEntry(entry: BaseEntry): Promise<Entry | null> {
    try {
        const {id, idEmployee, idEntryType, idUser, EntryDate, Note} = entry;
        let {Duration} = entry;
        if (!id) {
            return await saveNewEntry(entry);
        }
        if (!EntryDate) {
            return Promise.reject(new Error('Invalid entry date'));
        }

        const existing = await loadEmployeeEntry({idEmployee, id});

        if (idEntryType === ENTRY_TYPES.TIMECLOCK) {
            if (existing && existing.Duration !== Duration) {
                Duration = existing.Duration;
            }
        }
        const sql = `UPDATE timeclock.Entry
                     SET idEntryType = :idEntryType,
                         EntryDate   = UNIX_TIMESTAMP(:EntryDate),
                         Duration    = :Duration,
                         Note        = :Note,
                         idUser      = :idUser
                     WHERE id = :id`;
        await mysql2Pool.query(sql, {id, idEntryType, idUser, EntryDate, Duration, Note: Note || ''});
        if (existing && existing.Approved && (Duration !== existing.Duration || changeRequiresApproval(existing.idEntryType, idEntryType))) {
            await employeeApproveEntries(existing.idEmployee, existing.idPayPeriod, false);
            await supervisorApproveEntries(existing.idEmployee, existing.idPayPeriod, 0, false);
            if (entry.idEntryType !== ENTRY_TYPES.AUTOMATIC) {
                await autoGenerateSalaryEntries(idEmployee, existing.idPayPeriod);
            }
        }
        return await loadEmployeeEntry({idEmployee, id});
    } catch (err: unknown) {
        if (err instanceof Error) {
            debug("clockIn()", err.message);
            return Promise.reject(err);
        }
        return Promise.reject(new Error('saveEntry()'));
    }
}


interface EntryRow extends Entry, RowDataPacket {
}

export async function loadPayPeriodEntries(idEmployee: string | number, idPayPeriod: string | number): Promise<Entry[]> {
    try {
        const query = `SELECT e.id,
                              pp.id                      AS idPayPeriod,
                              e.idEmployee,
                              e.idEntryType,
                              e.idUser,
                              FROM_UNIXTIME(e.EntryDate) AS EntryDate,
                              IF(
                                          YEARWEEK(FROM_UNIXTIME(e.EntryDate), 1) =
                                          YEARWEEK(FROM_UNIXTIME(pp.StartDate), 1)
                                  , 0, 1)                AS Week,
                              e.Duration,
                              e.Note,
                              e.EmployeeApproved,
                              e.EmployeeApprovalTime,
                              e.Approved,
                              e.ApprovalTime,
                              e.ApprovedBy,
                              e.deleted,
                              e.deletedBy,
                              e.timestamp
                       FROM timeclock.Entry e
                            INNER JOIN timeclock.PayPeriods pp
                                       ON pp.id = :idPayPeriod AND e.EntryDate BETWEEN pp.StartDate AND pp.EndDate
                       WHERE e.idEmployee = :idEmployee
                       ORDER BY EntryDate, idEntryType`;
        const params = {idEmployee, idPayPeriod};

        const [rows] = await mysql2Pool.query<EntryRow[]>(query, params);
        const entries = await loadEntriesHelper(rows);
        return await validateEntries(entries);
    } catch (err: unknown) {
        if (err instanceof Error) {
            debug("loadPayPeriodEntries()", err.message);
            return Promise.reject(err);
        }
        return Promise.reject(new Error('loadPayPeriodEntries'));
    }
}

async function loadEntriesHelper(rows: Entry[]): Promise<Entry[]> {
    try {
        if (!rows.length) {
            return [];
        }
        const idEntryList = rows.map(row => row.id || 0).filter(id => !!id);
        const entryActions = await loadEntryActions(idEntryList);
        return rows.map(row => {
            const actions = entryActions.filter(action => action.idEntry === row.id);
            return {
                ...row,
                errors: [],
                actions,
                EmployeeApproved: !!row.EmployeeApproved,
                Approved: !!row.Approved,
                deleted: !!row.deleted,
                isClockedIn: !row.deleted && isClockedIn(actions)
            }
        });
    } catch (err: unknown) {
        if (err instanceof Error) {
            debug("loadEntriesHelper()", err.message);
            return Promise.reject(err);
        }
        debug("loadEntriesHelper()", err);
        return Promise.reject(new Error('Error in loadEntriesHelper()'));
    }
}

export async function loadEntries(idEmployee: number | string, entryIDs: number[], skipValidation: boolean = false): Promise<Entry[]> {
    try {
        if (entryIDs.length === 0) {
            return [];
        }
        const query = `SELECT e.id,
                              pp.id                      AS idPayPeriod,
                              e.idEmployee,
                              e.idEntryType,
                              e.idUser,
                              FROM_UNIXTIME(e.EntryDate) AS EntryDate,
                              IF(
                                          YEARWEEK(FROM_UNIXTIME(e.EntryDate), 1) =
                                          YEARWEEK(FROM_UNIXTIME(pp.StartDate), 1)
                                  , 0, 1)                AS Week,
                              e.Duration,
                              e.Note,
                              e.EmployeeApproved,
                              e.EmployeeApprovalTime,
                              e.Approved,
                              e.ApprovalTime,
                              e.ApprovedBy,
                              e.deleted,
                              e.deletedBy,
                              e.idPayPeriod,
                              e.timestamp
                       FROM timeclock.Entry e
                            INNER JOIN timeclock.PayPeriods pp
                                       ON e.EntryDate BETWEEN pp.StartDate AND pp.EndDate
                       WHERE e.idEmployee = :idEmployee
                         AND e.id IN (:entryIDs)
                       ORDER BY EntryDate, idEntryType`;
        const params = {idEmployee, entryIDs};

        const [rows] = await mysql2Pool.query<EntryRow[]>(query, params);
        const entries = await loadEntriesHelper(rows);
        if (skipValidation) {
            return entries;
        }
        return await validateEntries(entries);
    } catch (err: unknown) {
        if (err instanceof Error) {
        }
        debug("loadEntries()", err);
        return Promise.reject(new Error('Error in loadEntries()'));
    }
}

export async function deleteClockEntry({
                                           idEmployee,
                                           idEntry,
                                           idUser,
                                           action,
                                           comment
                                       }: AdjustClockProps): Promise<ClockActionResult> {
    try {
        const existing = await loadEmployeeEntry({idEmployee, id: idEntry});
        if (!existing) {
            return Promise.reject(new Error('Clock entry not found'));
        }
        await saveEntryAction({
            ...action,
            idEntry: existing.id,
        });
        const sql = `UPDATE timeclock.Entry
                     SET deleted   = 1,
                         deletedBy = :idUser,
                         Note      = :Note
                     WHERE id = :id`;
        const args = {
            id: idEntry,
            Note: [existing.Note, comment].filter(val => !!val).join(';'),
            idUser,
        };
        await mysql2Pool.query(sql, args);
        await autoGenerateSalaryEntries(idEmployee, existing.idPayPeriod);
        const entry = await loadEmployeeEntry({idEmployee: idEmployee, id: existing.id});
        const warning = !entry ? 'Clock Entry not found' : undefined;
        return {entry, warning};
    } catch (err: unknown) {
        if (err instanceof Error) {
            debug("deleteClockEntry()", err.message);
            return Promise.reject(err);
        }
        debug("deleteClockEntry()", err);
        return Promise.reject(new Error('Error in deleteClockEntry()'));
    }
}

export async function employeeApproveEntries(idEmployee: number | string, idPayPeriod: number | string, approved: boolean) {
    try {
        const sql = `UPDATE timeclock.Entry
                     SET EmployeeApproved     = :approved,
                         EmployeeApprovalTime = IF(:approved, NOW(), NULL)
                     WHERE idEmployee = :idEmployee
                       AND idPayPeriod = :idPayPeriod`;
        const args = {idEmployee, idPayPeriod, approved: approved ? 1 : 0}
        await mysql2Pool.query(sql, args);
    } catch (err: unknown) {
        if (err instanceof Error) {
            debug("employeeApproveEntries()", err.message);
            return Promise.reject(err);
        }
        debug("employeeApproveEntries()", err);
        return Promise.reject(new Error('Error in employeeApproveEntries()'));
    }
}

export async function supervisorApproveEntries(idEmployee: number | string, idPayPeriod: number | string, idUser: number | string, approved: boolean) {
    try {
        const sql = `UPDATE timeclock.Entry
                     SET Approved     = :approved,
                         ApprovalTime = IF(:approved, NOW(), NULL),
                         ApprovedBy   = :idUser
                     WHERE idEmployee = :idEmployee
                       AND idPayPeriod = :idPayPeriod`;
        const args = {idEmployee, idPayPeriod, approved: approved ? 1 : 0, idUser};
        await mysql2Pool.query(sql, args);
    } catch (err: unknown) {
        if (err instanceof Error) {
            debug("employeeApproveEntries()", err.message);
            return Promise.reject(err);
        }
        debug("employeeApproveEntries()", err);
        return Promise.reject(new Error('Error in employeeApproveEntries()'));
    }
}

export async function autoGenerateSalaryEntries(idEmployee: number, idPayPeriod: number): Promise<void> {
    try {
        const [employee] = await loadEmployees({
            userId: API_USER_ID,
            idEmployee
        });
        if (!employee || employee.EmployeeStatus !== 'A' || employee.PayMethod !== 'S') {
            return;
        }
        const [payPeriod] = await loadPayPeriods(idPayPeriod);
        if (!payPeriod || payPeriod.completed) {
            return Promise.reject(new Error('Invalid Pay Period'))
        }

        const entries = await loadPayPeriodEntries(idEmployee, idPayPeriod);
        const [entryW1 = defaultAutoEntry, entryW2 = defaultAutoEntry] = entries
            .filter(e => e.idEntryType === ENTRY_TYPES.AUTOMATIC && !e.deleted)
            .sort(entrySorter);
        const totals = await parseWeekTotals(entries, true);
        if (totals[0].Duration > 0 || !entryW1.id) {
            if (!entryW1.id) {
                entryW1.EntryDate = payPeriod.startDate;
                entryW1.Note = 'Auto-Generated';
            }
            entryW1.Duration = STD_HOURS - totals[0].Duration;
            await saveEntry(entryW1);
        }
        if (totals[1].Duration > 0 || !entryW2.id) {
            if (!entryW2.id) {
                entryW2.EntryDate = payPeriod.week2StartDate;
                entryW2.Note = 'Auto-Generated';
            }
            entryW2.Duration = STD_HOURS - totals[0].Duration;
            await saveEntry(entryW2);
        }
    } catch (err: unknown) {
        if (err instanceof Error) {
            debug("autoGenerateSalaryEntries()", err.message);
            return Promise.reject(err);
        }
        debug("autoGenerateSalaryEntries()", err);
        return Promise.reject(new Error('Error in autoGenerateSalaryEntries()'));
    }
}
