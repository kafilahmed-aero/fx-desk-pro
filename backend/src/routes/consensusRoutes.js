import { Router } from "express";
import {
  getActiveOpportunitiesController,
  getActivePairStatesController,
  getConsensusController,
  getLiveConsensusController,
} from "../controllers/consensusController.js";

const router = Router();

router.get("/", getConsensusController);
router.get("/active-pairs", getActivePairStatesController);
router.get("/live", getLiveConsensusController);
router.get("/opportunities", getActiveOpportunitiesController);

export default router;
