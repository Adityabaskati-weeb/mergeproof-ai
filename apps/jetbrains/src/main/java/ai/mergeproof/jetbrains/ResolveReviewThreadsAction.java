package ai.mergeproof.jetbrains;

import com.intellij.openapi.project.Project;

public final class ResolveReviewThreadsAction extends CliAction {
    @Override protected String[] command(Project project, String input) {
        return npmCommand("resolve", input, "--", "--json");
    }
}
