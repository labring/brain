import { type MockEntry, MockStore } from "../store/mock-store";
import { Folder } from "./folder";
import { SelectControl } from "./select-control";
import { Toggle } from "./toggle";

/**
 * One registered mock in the panel: MOCK badge, enabled toggle, scenario
 * select. Every change writes through the mock's source — the section holds
 * no state of its own.
 */
export function MockSection({ mock }: { mock: MockEntry }) {
  return (
    <Folder
      defaultOpen={true}
      title={
        <>
          {mock.def.title}
          <span className="dev-tweaks-mock-badge">MOCK</span>
        </>
      }
    >
      <Toggle
        checked={mock.state.enabled}
        label="Enabled"
        onChange={(enabled) => MockStore.setEnabled(mock.key, enabled)}
      />
      <SelectControl
        label="Scenario"
        onChange={(scenario) => MockStore.setScenario(mock.key, scenario)}
        options={[...mock.def.scenarios]}
        value={mock.state.scenario}
      />
      {mock.def.note && (
        <div className="dev-tweaks-mock-note">{mock.def.note}</div>
      )}
    </Folder>
  );
}
