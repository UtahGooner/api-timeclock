import Debug from 'debug';
import {NextFunction, Request, Response, Router} from 'express';
import {
    delJobPosting,
    getActiveJobPostings,
    getJobPostings,
    postJobDescriptionFile,
    postJobPosting,
} from "./jobs/job-postings.js";
import {validateRole, validateUser} from "chums-local-modules";
import {deleteBanner, getActiveBanners, getBanners, postBanner, uploadBanner} from "./images/image-handler.js";
import {getDepartments} from "./time-clock/departments.js";
import {deleteSupervisor, getEmployeeSupervisors, getSupervisors, postSupervisor} from "./time-clock/supervisors.js";
import {
    getEmployee,
    getEmployeeList,
    getEmployeePayPeriod,
    getEmployeeTotals,
    postHSAKey,
    postLoginCode
} from "./time-clock/employee.js";
import {buildPayPeriods, getCurrentPayPeriod, getPayPeriods, postCompletePayPeriod} from "./time-clock/pay-periods.js";
import {getPayPeriodSpreadSheet, getPayPeriodSSData} from "./payroll/pay-period-spreadsheet.js";
import {getPRImportFile, testPRImportFile} from "./payroll/sage-import.js";
import {postClockIn, postClockOut} from "./time-clock/clock-actions.js";

const debug = Debug('chums:lib:router');

function logPath(req: Request, res: Response, next: NextFunction) {
    const user = res.locals.profile?.user?.email || res.locals.profile?.user?.id || '-';
    const {ip, method, originalUrl} = req;
    const referer = req.get('referer') || '';
    debug(ip, user, method, originalUrl, referer);
    next();
}

const supervisorRoles = ['tcadmin', 'tcsupervisor'];
const adminRoles = ['tcadmin'];

export const router = Router();

const validateAdmin = validateRole(adminRoles);
const validateSupervisor = validateRole(supervisorRoles);

// routes that can be accessed without valid login

router.post('/clock/in', postClockIn);
router.post('/clock/out', postClockOut);
router.post('/employees/code/:loginCode', getEmployee);
router.get('/images/active', getActiveBanners);
router.get('/job-postings/active/:id(\\d+)?', getActiveJobPostings);


router.use(logPath, validateUser);

router.get('/departments', validateSupervisor, getDepartments);
router.get('/employees', validateSupervisor, getEmployeeList);
router.get('/employees/id/:idEmployee(\\d+)', validateSupervisor, getEmployee);
router.get('/employees/:department/:employeeNumber(\\d+)', validateSupervisor, getEmployee);
router.post('/employees/:idEmployee(\\d+)/hsa-key', validateAdmin, postHSAKey);
router.post('/employees/:idEmployee(\\d+)/login-code', validateSupervisor, postLoginCode);

router.get('/images/:id(\\d+)?', validateAdmin, getBanners);
router.post('/images/:id(\\d+)', validateAdmin, postBanner);
router.delete('/images/:id(\\d+)', validateAdmin, deleteBanner);
router.post('/image', validateAdmin, uploadBanner);

router.get('/job-postings/:id(\\d+)?', validateAdmin, getJobPostings);
router.post('/job-postings', validateAdmin, postJobPosting);
router.post('/job-postings/:id(\\d+)/upload-pdf', validateAdmin, postJobDescriptionFile);
router.put('/job-postings/:id(\\d+)', validateAdmin, postJobPosting);
router.delete('/job-postings/:id(\\d+)', validateAdmin, delJobPosting);

router.get('/pay-period', getCurrentPayPeriod);
router.get('/pay-period/:idPayPeriod(\\d+)?', getPayPeriods);
router.get('/pay-period/:idPayPeriod(\\d+)/employee/:idEmployee(\\d+)', getEmployeePayPeriod);
router.get('/pay-period/:idPayPeriod(\\d+)/totals/:idEmployee(\\d+)?', getEmployeeTotals);
router.get('/pay-period/:idPayPeriod(\\d+)/totals/xlsx/data', getPayPeriodSSData);
router.get('/pay-period/:idPayPeriod(\\d+)/totals/xlsx', getPayPeriodSpreadSheet);
router.get('/pay-period/on/:date', getCurrentPayPeriod);
router.post('/pay-period/:idPayPeriod(\\d+)/complete', validateAdmin, postCompletePayPeriod);
router.post('/pay-period/build', buildPayPeriods);

router.get('/sage-import/:idPayPeriod(\\d+)/download', validateAdmin, getPRImportFile)
router.get('/sage-import/:idPayPeriod(\\d+)/test', validateAdmin, testPRImportFile);

router.get('/supervisors', validateSupervisor, getSupervisors);
router.get('/supervisors/:idEmployee', getEmployeeSupervisors);
router.post('/supervisors/:idEmployee(\\d+)/:idUser(\\d+)', validateSupervisor, postSupervisor);
router.delete('/supervisors/:idEmployee(\\d+)/:idUser(\\d+)', validateSupervisor, deleteSupervisor);
