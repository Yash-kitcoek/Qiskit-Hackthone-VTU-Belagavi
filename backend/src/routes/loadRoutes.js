import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { createLoad, getMyLoads } from "../controllers/loadController.js";
import { requireActiveSubscription } from "../middleware/requireActiveSubscription.js";

const router = Router();
router.use(requireAuth);
router.get("/mine", getMyLoads);
router.post("/", requireActiveSubscription, createLoad);
export default router;
