using UnrealBuildTool;

public class DotPerformanceTarget : TargetRules
{
    public DotPerformanceTarget(TargetInfo Target) : base(Target)
    {
        Type = TargetType.Game;
        DefaultBuildSettings = BuildSettingsVersion.V7;
        IncludeOrderVersion = EngineIncludeOrderVersion.Latest;
        ExtraModuleNames.Add("DotPerformance");
    }
}
