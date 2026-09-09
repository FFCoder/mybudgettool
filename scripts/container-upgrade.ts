import {backupDatabase, config, reportFailure, SetupError} from './lib/lifecycle';
import {migrate} from '../src/server/migrations';
// Dependency installation, typechecking and unit tests run when building the image.
// Runtime work is limited to backup and migration; the image is not modified.
let backup:string|undefined;
try {
 const args=process.argv.slice(2);
 if(args.length!==3 || args[0]!=='--maintenance-confirmed' || args[1]!=='--backup-dir' || !args[2])
  throw new SetupError('Stop web and other writers, then use --maintenance-confirmed --backup-dir /backups.');
 const {databaseUrl}=config();
 backup=await backupDatabase('/app',databaseUrl,args[2]);
 console.log(`Verified backup: ${backup}`);
 const result=await migrate(databaseUrl);
 console.log(`Container upgrade complete: ${result.applied.length} migration(s). Start the new web image and verify before allowing writes.`);
} catch(error) {
 reportFailure(error);
 if(backup) console.error(`Backup retained at ${backup}. Keep writers stopped; restore only to a separate empty database if recovery is necessary.`);
}
