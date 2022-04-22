import Debug from 'debug';
import {Employee} from "../types";
import {RowDataPacket} from "mysql2";
import {mysql2Pool} from "chums-local-modules";
import {Request, Response} from "express";
import {loadEmployeeLatestEntry, loadPayPeriodEntries} from "./entry.js";
import {parseWeekTotals} from "./utils.js";
import {loadCurrentPayPeriod} from "./pay-periods.js";


const debug = Debug('chums:lib:time-clock:employee');


interface EmployeeRow extends Employee, RowDataPacket {
}

interface LoadEmployeeProps {
    loginCode?: string | null,
    userId?: number,
    idPayPeriod?: string | number | null,
    department?: string | null,
    employeeNumber?: string | null,
    idEmployee?: string | number | null,
    includeInactive?: boolean | null,
}

/**
 *
 * @param userId - used for filtering employees that the user has access to
 * @param idPayPeriod - if requesting employees from a not-current
 * @param loginCode -
 * @param department
 * @param employeeNumber
 * @param idEmployee
 * @param includeInactive
 */
export async function loadEmployees({
                                        userId = 0,
                                        idPayPeriod = null,
                                        loginCode = null,
                                        department = null,
                                        employeeNumber = null,
                                        idEmployee = null,
                                        includeInactive = null,
                                    }: LoadEmployeeProps): Promise<Employee[]> {
    try {
        const query = `SELECT l.id,
                              LoginCode,
                              Department,
                              EmployeeNumber,
                              EmployeeStatus,
                              FirstName,
                              LastName,
                              HireDate,
                              TerminationDate,
                              PayMethod,
                              AutopayHours,
                              HoursAccrued,
                              HoursUsed,
                              AnnualHourLimit,
                              CarryOverHours,
                              (CarryOverHours + HoursAccrued - HoursUsed) AS HoursAvailable,
                              hsaEmployeeKey
                       FROM timeclock.EmployeeLink l
                            LEFT JOIN (
                                      SELECT el.id
                                      FROM timeclock.PayPeriods pp
                                           INNER JOIN timeclock.EmployeeLink el
                                                      ON el.HireDate < FROM_UNIXTIME(pp.EndDate)
                                                          AND IFNULL(el.TerminationDate, FROM_UNIXTIME(pp.EndDate)) >
                                                              FROM_UNIXTIME(pp.StartDate)
                                      WHERE IF(IFNULL(:idPayPeriod, 0) = 0,
                                               UNIX_TIMESTAMP() BETWEEN pp.StartDate AND pp.EndDate,
                                               pp.id = :idPayPeriod)
                                      ) ppEmp
                                      ON ppEmp.id = l.id
                       WHERE (
                           # select by login code without validating a supervisor or admin
                                   LoginCode = :loginCode
                               AND NOT ISNULL(:loginCode)
                               AND EmployeeStatus = 'A'
                           )
                          OR (
                           #
                               (
                                   # user has role tcadmin
                                           (
                                           SELECT COUNT(*)
                                           FROM users.vw_usergroups
                                           WHERE ROLE = 'tcadmin'
                                             AND userid = :userId) > 0
                                       # API Access
                                       OR (SELECT count(*) FROM users.api_access where enabled = 1 AND id_api_access = (:userId * -1)) > 0
                                             
                                        # employees that the user supervises
                                       OR l.id IN (
                                                  SELECT idEmployee
                                                  FROM timeclock.Supervision
                                                  WHERE idUser = :userId)
                                   )
                               AND (ppEmp.id IS NOT NULL
                               OR :includeInactive = '1'
                               OR
                                    (:department IS NOT NULL AND :employeeNumber IS NOT NULL) # allow inactive if using employee number
                               OR :idEmployee IS NOT NULL # allow inactive if using employee id
                                   )
                               AND (
                                       (IFNULL(:idEmployee, 0) = l.id) # select employee by id
                                       OR
                                       (IFNULL(:department, '') = Department
                                           AND IFNULL(:employeeNumber, '') =
                                               EmployeeNumber) # select by department / employee number
                                       OR (:loginCode IS NULL
                                       AND :department IS NULL
                                       AND :employeeNumber IS NULL
                                       AND :idEmployee IS NULL) # Select all employees if all parameters are null
                                   )
                           )
                       ORDER BY FirstName, LastName, EmployeeNumber`;
        const data = {
            userId,
            idPayPeriod,
            loginCode,
            department,
            employeeNumber,
            idEmployee,
            includeInactive: includeInactive ? 1 : 0
        };
        debug('loadEmployees()', data);
        const [rows] = await mysql2Pool.query<EmployeeRow[]>(query, data);
        return rows.map(row => {
            return {
                ...row,
                AutopayHours: Number(row.AutopayHours),
                HoursAccrued: Number(row.HoursAccrued),
                HoursUsed: Number(row.HoursUsed),
                AnnualHourLimit: Number(row.AnnualHourLimit),
                CarryOverHours: Number(row.CarryOverHours),
                HoursAvailable: Number(row.HoursAvailable),
            }
        });
    } catch (err: unknown) {
        if (err instanceof Error) {
            debug("loadEmployees()", err.message);
            return Promise.reject(err);
        }
        return Promise.reject(new Error('loadEmployees()'))
    }
}

interface SaveEmployeeLoginCodeProps {
    userId: number,
    idEmployee: number | string,
    loginCode: string,
}

export async function saveEmployeeLoginCode({
                                                userId,
                                                idEmployee,
                                                loginCode
                                            }: SaveEmployeeLoginCodeProps): Promise<Employee> {
    try {
        idEmployee = Number(idEmployee);
        const [exists] = await loadEmployees({userId, idEmployee});
        if (!exists) {
            return Promise.reject(new Error(`Employee ${idEmployee} does not exist`));
        }
        const [existingEmployee] = await loadEmployees({userId, loginCode});
        if (existingEmployee && existingEmployee.id !== idEmployee) {
            return Promise.reject(new Error(`Login code '${loginCode}' is already is use.`));
        }
        const sql = `UPDATE timeclock.Employee
                     SET LoginCode = :loginCode
                     WHERE id = :idEmployee`;
        const data = {idEmployee, loginCode};
        await mysql2Pool.query(sql, data);
        const [employee] = await loadEmployees({userId, idEmployee});
        return employee;
    } catch (err: unknown) {
        if (err instanceof Error) {
            debug("saveEmployeeLoginCode()", err.message);
            return Promise.reject(err);
        }
        debug("saveEmployeeLoginCode()", err);
        return Promise.reject(new Error('Error in saveEmployeeLoginCode()'));
    }
}

export const postLoginCode = async (req: Request, res: Response) => {
    try {
        const employee = await saveEmployeeLoginCode({...req.body, userId: res.locals.profile.user.id});
        res.json({employee});
    } catch (err: unknown) {
        if (err instanceof Error) {
            debug("postLoginCode()", err.message);
            return res.json({error: err.message, name: err.name});
        }
        res.json({error: 'unknown error in postLoginCode'});
    }
}

interface SaveEmployeeHSAKeyProps {
    userId: number,
    idEmployee: number | string,
    hsaKey: string,
}

export async function saveEmployeeHSAKey({userId, idEmployee, hsaKey}: SaveEmployeeHSAKeyProps): Promise<Employee> {
    try {
        idEmployee = Number(idEmployee);
        const [exists] = await loadEmployees({
            userId, idEmployee
        });
        if (!exists) {
            return Promise.reject(new Error(`Employee ${idEmployee} does not exist`));
        }
        const sql = `UPDATE timeclock.Employee
                     SET hsaEmployeeKey = :hsaKey
                     WHERE id = :idEmployee`;
        const args = {idEmployee, hsaKey};
        await mysql2Pool.query(sql, args);
        const [employee] = await loadEmployees({
            userId,
            idEmployee
        });
        return employee;
    } catch (err: unknown) {
        if (err instanceof Error) {
            debug("saveEmployeeHSAKey()", err.message);
            return Promise.reject(err);
        }
        return Promise.reject(new Error('saveEmployeeHSAKey()'))
    }
}

export const postHSAKey = async (req: Request, res: Response) => {
    try {
        const employee = await saveEmployeeHSAKey({...req.body, userId: res.locals.user.id});
        res.json({employee});
    } catch (err: unknown) {
        if (err instanceof Error) {
            debug("postHSAKey()", err.message);
            return res.json({error: err.message});
        }
        return res.json({error: 'unknown error in postHSAKey()'});
    }
}

export const getEmployee = async (req: Request, res: Response) => {
    try {
        const [employee] = await loadEmployees({
            ...req.params,
            userId: res.locals.profile?.user?.id,
        });
        const payPeriod = await loadCurrentPayPeriod();
        const entries = await loadPayPeriodEntries(employee.id, payPeriod?.id || 0);
        if (employee.EmployeeStatus === 'A' && employee.PayMethod === 'S' && entries.length === 0) {

        }
        const hasErrors = entries.filter(entry => entry.errors.length).length > 0;
        const totals = await parseWeekTotals(entries);
        res.json({employee, entries, hasErrors, totals})
    } catch (err: unknown) {
        if (err instanceof Error) {
            debug("getEmployee()", err.message);
            res.json({error: err.message});
        }
        res.json({error: 'unknown error in getEmployee()'})
    }
};

export const getEmployeeList = async (req: Request, res: Response) => {
    try {

        const employees = await loadEmployees({
            ...req.params,
            userId: res.locals.profile?.user?.id,
        });
        res.json({employees})
    } catch (err: unknown) {
        if (err instanceof Error) {
            debug("getEmployeeList()", err.message);
            return res.json({error: err.message, name: err.name});
        }
        res.json({error: 'unknown error in getEmployeeList'});
    }
};


export const getEmployeePayPeriod = async (req: Request, res: Response) => {
    try {
        const [employee] = await loadEmployees({
            userId: res.locals.profile.user.id,
            idPayPeriod: req.params.idPayPeriod,
            idEmployee: req.params.idEmployee
        });
        if (!employee) {
            return res.status(404).json({error: `Employee ${req.params.idEmployee} not found`});
        }
        const entries = await loadPayPeriodEntries(req.params.idEmployee, req.params.idPayPeriod);
        const hasErrors = entries.filter(entry => entry.errors.length).length > 0;
        const totals = await parseWeekTotals(entries);
        res.json({employee, hasErrors, entries, totals});
    } catch (err: unknown) {
        if (err instanceof Error) {
            debug("getEmployeePayPeriodEntries()", err.message);
            return res.json({error: err.message, name: err.name});
        }
        res.json({error: 'unknown error in getEmployeePayPeriodEntries'});
    }
};

export const getEmployeeTotals = async (req: Request, res: Response) => {
    try {
        const idPayPeriod = Number(req.params.idPayPeriod);
        const employees = await loadEmployees({
            userId: res.locals.profile.user.id,
            idEmployee: req.params.idEmployee,
        });
        const employeeTotals = await Promise.all(employees.map(async emp => {
            const totals = await parseWeekTotals(await loadPayPeriodEntries(emp.id, idPayPeriod))
            return {
                ...emp,
                idPayPeriod,
                weeks: totals,
            }
        }));
        res.json({employeeTotals});
    } catch (err: unknown) {
        if (err instanceof Error) {
            debug("getEmployeeTotals()", err.message);
            return res.json({error: err.message, name: err.name});
        }
        res.json({error: 'unknown error in getEmployeeTotals'});
    }
}
