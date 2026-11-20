import { Router, type IRouter } from "express";
import healthRouter from "./health";
import lastcallRouter from "./lastcall";
import intakeRouter from "./intake";
import donationDetailsRouter from "./donation-details";

const router: IRouter = Router();

router.use(healthRouter);
router.use((_req, res, next) => { res.setHeader("Cache-Control", "no-store"); next(); });
router.use(intakeRouter);
router.use(donationDetailsRouter);
router.use(lastcallRouter);

export default router;
