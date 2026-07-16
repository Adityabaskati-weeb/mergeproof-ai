package ai.mergeproof.jetbrains;

import com.intellij.openapi.actionSystem.AnAction;
import com.intellij.openapi.actionSystem.AnActionEvent;
import com.intellij.openapi.project.Project;
import com.intellij.openapi.ui.Messages;
import java.io.File;
import java.io.IOException;
import java.util.Arrays;

abstract class CliAction extends AnAction {
    protected abstract String[] command(Project project, String input);

    @Override
    public void actionPerformed(AnActionEvent event) {
        Project project = event.getProject();
        if (project == null || project.getBasePath() == null) {
            Messages.showErrorDialog("Open a repository before running MergeProof.", "MergeProof");
            return;
        }
        String input = Messages.showInputDialog(project, "GitHub pull request URL (leave empty for local review)", "MergeProof", Messages.getQuestionIcon());
        if (input == null) return;
        String[] command = command(project, input.trim());
        try {
            Process process = new ProcessBuilder(command).directory(new File(project.getBasePath())).redirectErrorStream(true).start();
            String output = new String(process.getInputStream().readAllBytes());
            int exit = process.waitFor();
            Messages.showInfoMessage(project, output, exit == 0 ? "MergeProof" : "MergeProof needs attention");
        } catch (IOException | InterruptedException error) {
            Thread.currentThread().interrupt();
            Messages.showErrorDialog(project, error.getMessage(), "MergeProof failed");
        }
    }

    protected String[] npmCommand(String... args) {
        String executable = System.getProperty("os.name", "").toLowerCase().contains("win") ? "npm.cmd" : "npm";
        String[] command = new String[args.length + 4];
        command[0] = executable; command[1] = "run"; command[2] = "cli"; command[3] = "--";
        System.arraycopy(args, 0, command, 4, args.length);
        return command;
    }
}
