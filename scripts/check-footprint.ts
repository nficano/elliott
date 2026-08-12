import budgets from "../config/footprint-budgets.json";
import { enforceFootprintBudgets } from "../src/observability/index";

enforceFootprintBudgets(budgets);
