import { Router } from "express";
import {
  loginController,
  logoutController,
  meController,
} from "../controllers/authController.js";

const router = Router();

router.post("/login", loginController);
router.post("/logout", logoutController);
router.get("/me", meController);

export default router;
