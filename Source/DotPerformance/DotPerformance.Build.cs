using UnrealBuildTool;

public class DotPerformance : ModuleRules
{
    public DotPerformance(ReadOnlyTargetRules Target) : base(Target)
    {
        PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;
        PublicDependencyModuleNames.AddRange(new[] { "Core", "CoreUObject", "Engine", "InputCore", "Json", "Networking", "Sockets" });
    }
}
