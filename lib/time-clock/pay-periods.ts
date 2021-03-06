import Debug from 'debug';
import {mysql2Pool} from 'chums-local-modules';
import {add as dateAdd, set as setDate, sub as dateSub} from 'date-fns';
import {PayPeriod, PayPeriodSSRecord, PRImportData} from "../types";
import {RowDataPacket} from "mysql2";
import {PoolConnection} from "mysql2/promise";
import {Request, Response} from "express";

const debug = Debug('chums:lib:timeclock:pay-periods');

interface PayPeriodRow extends PayPeriod, RowDataPacket {
}

export async function loadPayPeriods(id?: number | string): Promise<PayPeriod[]> {
    try {
        const query = `SELECT id,
                              FROM_UNIXTIME(StartDate) AS startDate,
                              DATE_ADD(FROM_UNIXTIME(StartDate), INTERVAL 1 Week) as week2StartDate,
                              FROM_UNIXTIME(EndDate)   AS endDate,
                              completed
                       FROM timeclock.PayPeriods
                       WHERE (id = :id OR :id IS NULL)
                       ORDER BY completed, startDate DESC`;
        const data = {id};
        const [rows] = await mysql2Pool.query<PayPeriodRow[]>(query, data);
        return rows.map(row => ({
            ...row,
            completed: !!row.completed
        }));
    } catch (err: unknown) {
        if (err instanceof Error) {
            debug("loadPayPeriods()", err.message);
            return Promise.reject(err);
        }
        debug("loadPayPeriods()", err);
        return Promise.reject(err);
    }
}

export async function loadCurrentPayPeriod(today?: string): Promise<PayPeriod|null> {
    try {
        const sql = `SELECT id,
                            FROM_UNIXTIME(StartDate) AS startDate,
                            DATE_ADD(FROM_UNIXTIME(StartDate), INTERVAL 1 Week) as week2StartDate,
                            FROM_UNIXTIME(EndDate)   AS endDate,
                            completed
                     FROM timeclock.PayPeriods
                     WHERE IF(ISNULL(:today), UNIX_TIMESTAMP(), UNIX_TIMESTAMP(:today)) BETWEEN StartDate AND EndDate `;
        const [rows] = await mysql2Pool.query<PayPeriodRow[]>(sql, {today});
        if (rows.length) {
            return {
                ...rows[0],
                completed: !!rows[0].completed
            }
        }
        return null;
    } catch (err: unknown) {
        if (err instanceof Error) {
            debug("loadCurrentPayPeriod()", err.message);
            return Promise.reject(err);
        }
        debug("loadCurrentPayPeriod()", err);
        return Promise.reject(new Error('Error in loadCurrentPayPeriod()'));
    }
}


async function createPayPeriods(): Promise<boolean> {
    let connection: PoolConnection | null = null;
    const startOfDay = {
        hours: 0,
        minutes: 0,
        seconds: 0,
        milliseconds: 0
    };
    const twoWeeks = {weeks: 2};
    const oneSecond = {seconds: 1};
    const oneDay = {days: 1};
    try {
        interface ResultRow extends RowDataPacket {
            maxStartDate: string,
            maxEndDate: string,
        }

        const currentYear = new Date().getFullYear();
        const queryExisting = `SELECT FROM_UNIXTIME(MAX(StartDate)) AS maxStartDate,
                                      FROM_UNIXTIME(MAX(EndDate))   AS maxEndDate
                               FROM timeclock.PayPeriods`;
        const queryInsert = `INSERT INTO timeclock.PayPeriods (StartDate, EndDate)
                             VALUES (UNIX_TIMESTAMP(:StartDate), UNIX_TIMESTAMP(:EndDate))`;

        let StartDate, EndDate;
        connection = await mysql2Pool.getConnection();
        const [rows] = await connection.query<ResultRow[]>(queryExisting);
        if (!rows.length) {
            connection.release();
            return false;
        }
        const [{maxStartDate, maxEndDate}] = rows;
        debug('createPayPeriods()', {maxStartDate, maxEndDate});

        StartDate = setDate(dateAdd(new Date(maxEndDate), {days: 1}), startOfDay);
        EndDate = dateSub(dateAdd(StartDate, twoWeeks), oneSecond);
        debug('createPayPeriods()', {StartDate, EndDate});
        let i = 0;
        if (new Date(maxStartDate).getFullYear() <= currentYear) {
            await connection.query(queryInsert, {StartDate, EndDate});
            while (StartDate.getFullYear() === currentYear && i < 52) {
                StartDate = setDate(dateAdd(new Date(EndDate), oneDay), startOfDay);
                EndDate = dateSub(dateAdd(StartDate, twoWeeks), oneSecond);
                await connection.query(queryInsert, {StartDate, EndDate});
                i += 1;
            }
        }
        connection.release();
        return true;
    } catch (err: unknown) {
        connection?.release();
        if (err instanceof Error) {
            debug("createPayPeriods()", err.message);
            return Promise.reject(err);
        }
        debug("createPayPeriods()", err);
        return Promise.reject(err);
    }
}


async function markPayPeriodCompleted(id: number | string): Promise<PayPeriod> {
    try {
        const [payPeriod] = await loadPayPeriods(id);
        if (!payPeriod || payPeriod.completed || new Date(payPeriod.endDate).valueOf() < new Date().valueOf()) {
            return Promise.reject(new Error('Unable to complete this pay period'));
        }
        const query = `UPDATE timeclock.PayPeriods SET completed = 1 WHERE id = :id`;
        await mysql2Pool.query(query, {id: payPeriod.id});
        const [_payPeriod] = await loadPayPeriods(id);
        return _payPeriod;
    } catch (err: unknown) {
        if (err instanceof Error) {
            debug("markPayPeriodCompleted()", err.message);
            return Promise.reject(err);
        }
        debug("markPayPeriodCompleted()", err);
        return Promise.reject(err);
    }
}

interface PayPeriodSSRow extends PayPeriodSSRecord, RowDataPacket {}
export async function loadPayPeriodSSEntries(idPayPeriod:number|string):Promise<PayPeriodSSRow[]> {
    try {
        const query = `SELECT ee.EmployeeKey,
                              CONCAT(ee.FirstName, ' ', ee.LastName)        AS EmployeeName,
                              ee.Department,
                              ee.EmployeeNumber,
                              ee.PayMethod,
                              SUM(IF(et.MASCode = '000001', e.Duration, 0)) AS Hours_000001,
                              SUM(IF(et.MASCode = '000002', e.Duration, 0)) AS Hours_000002,
                              SUM(IF(et.MASCode = '000003', e.Duration, 0)) AS Hours_000003,
                              SUM(IF(et.MASCode = '000004', e.Duration, 0)) AS Hours_000004,
                              SUM(IF(et.MASCode = '000011', e.Duration, 0)) AS Hours_000011,
                              SUM(IF(et.MASCode = 'ASSIST', e.Duration, 0)) AS Hours_ASSIST,
                              SUM(IF(et.MASCode = 'FMLA67', e.Duration, 0)) AS Hours_FMLA67,
                              SUM(IF(et.MASCode = 'FMLA10', e.Duration, 0)) AS Hours_FMLA10,
                              MAX(e.EmployeeApprovalTime)                   AS EmployeeApprovalTime,
                              MAX(e.ApprovalTime)                           AS SupervisorApprovalTime,
                              GROUP_CONCAT(DISTINCT u.name)                 AS SupervisorName,
                              YEARWEEK(FROM_UNIXTIME(e.EntryDate), 1)          AS WeekNumber,
                              SUM(e.Duration)                               AS seconds
                       FROM timeclock.Entry e
                            INNER JOIN timeclock.EmployeeLink ee
                                       ON ee.id = e.idEmployee
                            INNER JOIN timeclock.EntryType et
                                       ON et.id = e.idEntryType
                            INNER JOIN (
                                       SELECT StartDate, EndDate
                                       FROM timeclock.PayPeriods
                                       WHERE id = :idPayPeriod) pp
                            LEFT JOIN  users.users u
                                       ON e.ApprovedBy = u.id
                       WHERE e.EntryDate BETWEEN pp.StartDate AND pp.EndDate
                         AND (ee.EmployeeStatus = 'A' OR (
                               (ISNULL(ee.TerminationDate) OR pp.startDate < UNIX_TIMESTAMP(ee.TerminationDate))
                               AND pp.EndDate > UNIX_TIMESTAMP(ee.HireDate)))
                         AND e.deleted = 0
                       GROUP BY EmployeeKey, EmployeeName, ee.Department, ee.EmployeeNumber,
                                YEARWEEK(FROM_UNIXTIME(e.EntryDate), 1)
                       ORDER BY ee.Department, ee.EmployeeNumber, WeekNumber`;
        const data = {idPayPeriod};
        const [rows] = await mysql2Pool.query<PayPeriodSSRow[]>(query, data);
        return rows;
    } catch(err:unknown) {
        if (err instanceof Error) {
            debug("loadPayPeriodSSData()", err.message);
            return Promise.reject(err);
        }
        debug("loadPayPeriodSSData()", err);
        return Promise.reject(new Error('Error in loadPayPeriodSSData()'));
    }
}


interface PRImportDataRow extends PRImportData, RowDataPacket {}
export async function loadPayPeriodImportData(idPayPeriod:number|string):Promise<PRImportData[]> {
    try {
        const query = `SELECT ee.EmployeeKey,
                              ee.Department,
                              ee.EmployeeNumber,
                              ee.PayMethod,
                              DATE(FROM_UNIXTIME(e.EntryDate)) AS    DayWorked,
                              WEEK(FROM_UNIXTIME(e.EntryDate), 1) AS WeekWorked,
                              et.MASCode AS                          EarningsCode,
                              et.ShortCode AS                        EarningsType,
                              ee.Department,
                              SUM(e.Duration) AS                     seconds
                       FROM timeclock.Entry e
                            INNER JOIN timeclock.EmployeeLink ee
                                       ON ee.id = e.idEmployee
                            INNER JOIN timeclock.EntryType et
                                       ON et.id = e.idEntryType
                            INNER JOIN (
                                       SELECT StartDate, EndDate
                                       FROM timeclock.PayPeriods
                                       WHERE id = :idPayPeriod) pp
                       WHERE e.EntryDate BETWEEN pp.StartDate AND pp.EndDate
                         AND e.deleted = 0
                         AND (ee.EmployeeStatus = 'A' OR ee.TerminationDate > FROM_UNIXTIME(e.EntryDate))
                       GROUP BY EmployeeKey, ee.Department, ee.EmployeeNumber, DayWorked, EarningsCode
                       ORDER BY ee.Department, ee.EmployeeNumber`;
        const data = {idPayPeriod};
        const [rows] = await mysql2Pool.query<PRImportDataRow[]>(query, data);
        return rows;
    } catch(err:unknown) {
        if (err instanceof Error) {
            debug("loadPayPeriodImportData()", err.message);
            return Promise.reject(err);
        }
        debug("loadPayPeriodImportData()", err);
        return Promise.reject(new Error('Error in loadPayPeriodImportData()'));
    }
}

export async function getPayPeriods(req: Request, res: Response) {
    try {
        const periods = await loadPayPeriods(req.params.idPayPeriod);
        res.json({periods});
    } catch (err: unknown) {
        if (err instanceof Error) {
            debug("getPayPeriods()", err.message);
            return res.json({error: err.message, name: err.name});
        }
        res.json({error: 'unknown error in getPayPeriods'});
    }
}

export async function putCompletePayPeriod(req: Request, res: Response) {
    try {
        const period = await markPayPeriodCompleted(req.params.id);
        res.json({period});
    } catch (err: unknown) {
        if (err instanceof Error) {
            debug("putCompletePayPeriod()", err.message);
            res.json({error: err.message});
        }
        debug("putCompletePayPeriod()", err);
        res.json({error: err});
    }
}

export async function buildPayPeriods(req: Request, res: Response) {
    try {
        const success = await createPayPeriods();
        res.json({success});
    } catch (err: unknown) {
        if (err instanceof Error) {
            debug("getBuildPayPeriods()", err.message);
            res.json({error: err.message});
        }
        debug("getBuildPayPeriods()", err);
        res.json({error: err});
    }

}

export async function getCurrentPayPeriod(req:Request, res:Response) {
    try {
        const payPeriod = await loadCurrentPayPeriod(req.params.date);
        res.json({payPeriod});
    } catch(err:unknown) {
        if (err instanceof Error) {
            debug("getCurrentPayPeriod()", err.message);
            return res.json({error: err.message, name: err.name});
        }
        res.json({error: 'unknown error in getCurrentPayPeriod'});
    }
}
