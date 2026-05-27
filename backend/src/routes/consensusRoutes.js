import { Router } from "express";
import {
  getActiveOpportunitiesController,
  getActivePairStatesController,
  getConsensusController,
  getLiveMarketOverviewController,
  getLiveConsensusController,
  getPairConsensusController,
  getWeightedConsensusController,
  streamLiveConsensusEventsController,
} from "../controllers/consensusController.js";

const router = Router();

router.get("/", getConsensusController);
router.get("/active-pairs", getActivePairStatesController);
router.get("/live", getLiveConsensusController);
router.get("/opportunities", getActiveOpportunitiesController);
router.get("/weighted-consensus", getWeightedConsensusController);
router.get("/weighted-consensus/:pair", getPairConsensusController);
router.get("/overview", getLiveMarketOverviewController);
router.get("/events", streamLiveConsensusEventsController);

export default router;
