/**
 * Shown when public/data is absent — a fresh clone, or a deploy built without
 * the generated game data. Explains the one command that fixes it rather than
 * rendering an empty map.
 */
export default function Setup() {
  return (
    <main className="setup">
      <div className="setup-card">
        <h1>Routeforge needs its dungeon data</h1>
        <p>
          Map tiles, enemy data, portraits and spell icons aren&apos;t committed to the
          repository — they&apos;re Blizzard&apos;s art and Mythic Dungeon Tools&apos; data, so they&apos;re
          generated from your own installation instead of redistributed.
        </p>
        <p>With World of Warcraft and the MDT addon installed, run:</p>
        <pre>
          <code>npm run data</code>
        </pre>
        <p className="setup-note">
          If WoW lives somewhere non-standard, point at it:
          <br />
          <code>MDT_PATH=&quot;/path/to/Interface/AddOns/MythicDungeonTools&quot; npm run data</code>
        </p>
        <p className="setup-note">
          Deploying to a host that has no game install? The generated{' '}
          <code>public/</code> folders have to be committed, or served from
          somewhere the build can reach.
        </p>
      </div>
    </main>
  )
}
