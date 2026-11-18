import { IsBoolean, IsNumber, IsOptional } from "class-validator";
import { Environment } from "@server/env";
import environment from "@server/utils/environment";

class GitSyncPluginEnvironment extends Environment {
  /**
   * How often, in seconds, repositories with bidirectional sync are checked
   * for new commits. Defaults to 5 minutes.
   */
  @IsOptional()
  @IsNumber()
  public GIT_SYNC_POLL_INTERVAL =
    this.toOptionalNumber(environment.GIT_SYNC_POLL_INTERVAL) ?? 300;

  /**
   * How long, in seconds, to wait after a change in Outline before it is
   * committed, so that several quick changes end up in one commit.
   */
  @IsOptional()
  @IsNumber()
  public GIT_SYNC_DEBOUNCE =
    this.toOptionalNumber(environment.GIT_SYNC_DEBOUNCE) ?? 30;

  /**
   * The directory that holds the working copies of synchronized repositories.
   * Defaults to a folder in the system temp directory.
   */
  @IsOptional()
  public GIT_SYNC_CACHE_DIR = this.toOptionalString(
    environment.GIT_SYNC_CACHE_DIR
  );

  /**
   * Allows repositories on plain http:// and file:// URLs, for local testing.
   * Only https:// is allowed otherwise.
   */
  @IsOptional()
  @IsBoolean()
  public GIT_SYNC_ALLOW_INSECURE_URLS = this.toBoolean(
    environment.GIT_SYNC_ALLOW_INSECURE_URLS ?? "false"
  );
}

export default new GitSyncPluginEnvironment();
