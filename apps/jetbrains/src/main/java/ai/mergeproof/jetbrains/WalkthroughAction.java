package ai.mergeproof.jetbrains;

import com.intellij.openapi.project.Project;

public final class WalkthroughAction extends CliAction {
    @Override protected String[] command(Project project, String input) {
        return npmCommand("walkthrough", input, "--", "--json", "--repo", project.getBasePath());
    }
}
