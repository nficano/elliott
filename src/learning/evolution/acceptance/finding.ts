import { EvolutionAcceptanceFinding } from "../model/index";

export const acceptanceFinding = (
  requirement: string,
  message: string,
): EvolutionAcceptanceFinding =>
  EvolutionAcceptanceFinding.make({ requirement, message });
