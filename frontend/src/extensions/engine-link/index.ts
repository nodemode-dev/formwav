import { fetchHealth } from "../../io/engine-client";
import { register } from "../registry";

register({
  id: "engine-link",
  setup(engine) {
    fetchHealth()
      .then((reply) => engine.setLink({ status: "ready", engineVersion: reply.version, coreVersion: reply.core ?? null }))
      .catch(() => engine.setLink({ status: "offline", engineVersion: null }));
  },
});
