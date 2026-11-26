#include "DotBehavior.h"

#include "Dom/JsonObject.h"
#include "HAL/FileManager.h"
#include "Misc/CommandLine.h"
#include "Misc/FileHelper.h"
#include "Misc/Parse.h"
#include "Misc/Paths.h"
#include "Serialization/JsonReader.h"
#include "Serialization/JsonSerializer.h"

namespace
{
const TCHAR* Names[] = {TEXT("hover"),TEXT("look"),TEXT("nod"),TEXT("two-step"),TEXT("bounce"),
    TEXT("glide"),TEXT("roll"),TEXT("spin"),TEXT("handoff"),
    TEXT("twist"),TEXT("shimmy"),TEXT("jump"),TEXT("flip"),TEXT("jack"),TEXT("skating"),
    TEXT("salsa-step"),TEXT("heel-toe"),TEXT("running-man"),TEXT("pas-de-bourree")};

FString MemoryPath()
{
    return FPaths::Combine(FPaths::ProjectSavedDir(),TEXT("Dot"),TEXT("MovementMemory.json"));
}
}

void FDotBehavior::Load()
{
    bBeatAudit=FParse::Param(FCommandLine::Get(),TEXT("DotBeatAudit"));
    Random.GenerateNewSeed();
    FString Saved;
    TSharedPtr<FJsonObject> Data;
    if (!FFileHelper::LoadFileToString(Saved,*MemoryPath()) || Saved.Len()>16384 ||
        !FJsonSerializer::Deserialize(TJsonReaderFactory<>::Create(Saved),Data) || !Data) return;
    const TSharedPtr<FJsonObject>* Moves=nullptr;
    if (Data->TryGetObjectField(TEXT("moves"),Moves))
    {
        for (int32 Index=0; Index<MoveCount; ++Index)
        {
            const TSharedPtr<FJsonObject>* Entry=nullptr;
            if (!(*Moves)->TryGetObjectField(Names[Index],Entry)) continue;
            double Score=0, Count=0;
            if ((*Entry)->TryGetNumberField(TEXT("preference"),Score) && FMath::IsFinite(Score))
                Preference[Index]=float(FMath::Clamp(Score,-1.0,1.0));
            if ((*Entry)->TryGetNumberField(TEXT("chosen"),Count) && FMath::IsFinite(Count))
                TimesChosen[Index]=int32(FMath::Clamp(Count,0.0,1000000.0));
        }
    }
    FString Last;
    if (Data->TryGetStringField(TEXT("last"),Last))
        for (int32 Index=0; Index<MoveCount; ++Index)
            if (Last==Names[Index]) LastChoice=static_cast<EDotBehaviorMove>(Index);
    Recent.Add(LastChoice);
}

void FDotBehavior::Save()
{
    if (!bDirty || bBeatAudit) return;
    const auto Data=MakeShared<FJsonObject>();
    const auto Moves=MakeShared<FJsonObject>();
    for (int32 Index=0; Index<MoveCount; ++Index)
    {
        const auto Entry=MakeShared<FJsonObject>();
        Entry->SetNumberField(TEXT("preference"),Preference[Index]);
        Entry->SetNumberField(TEXT("chosen"),TimesChosen[Index]);
        Moves->SetObjectField(Names[Index],Entry);
    }
    Data->SetNumberField(TEXT("version"),1);
    Data->SetStringField(TEXT("last"),Names[static_cast<int32>(LastChoice)]);
    Data->SetObjectField(TEXT("moves"),Moves);
    FString Encoded;
    FJsonSerializer::Serialize(Data,TJsonWriterFactory<>::Create(&Encoded));
    const FString Path=MemoryPath();
    const FString Temporary=Path+TEXT(".tmp");
    IFileManager::Get().MakeDirectory(*FPaths::GetPath(Path),true);
    if (FFileHelper::SaveStringToFile(Encoded,*Temporary) && IFileManager::Get().Move(*Path,*Temporary,true))
        bDirty=false;
}

void FDotBehavior::Learn(const FString& MoveName, int32 Direction)
{
    if (!Direction) return;
    int32 Index=static_cast<int32>(RecentPerformance);
    if (!MoveName.IsEmpty())
    {
        Index=INDEX_NONE;
        for (int32 Candidate=0; Candidate<MoveCount; ++Candidate)
            if (MoveName==Names[Candidate]) Index=Candidate;
        if (Index==INDEX_NONE) return;
    }
    Preference[Index]=FMath::Clamp(Preference[Index]+(Direction>0?.25f:-.25f),-1.f,1.f);
    bDirty=true;
    Save();
    UE_LOG(LogTemp,Display,TEXT("DOT_BEHAVIOR feedback move=%s direction=%d"),Names[Index],Direction>0?1:-1);
}

void FDotBehavior::Choose(float Bpm, float Energy, bool bPlaying, bool bOccupied, bool bHandoff)
{
    if (bOccupied)
    {
        Current=EDotBehaviorMove::Hover;
        PhraseBeats=4;
    }
    else if (bHandoff && Random.FRand()<.65f)
    {
        Current=EDotBehaviorMove::Handoff;
        PhraseBeats=4;
    }
    else
    {
        const float PlayingWeights[] = {.04f,.08f,.40f,1.55f,.55f+Energy,1.1f,.70f,
            .40f+Energy,0,1.25f,1.10f,.34f+Energy,.26f+Energy,1.50f,1.15f,1.05f,
            1.15f,.75f+Energy,1.05f};
        const float IdleWeights[] = {1.7f,1.25f,.35f,0,0,.12f,0,0,0,0,0,0,0,0,0,0,0,0,0};
        static_assert(UE_ARRAY_COUNT(Names)==MoveCount && UE_ARRAY_COUNT(PlayingWeights)==MoveCount &&
            UE_ARRAY_COUNT(IdleWeights)==MoveCount);
        float Weights[MoveCount]={};
        float Sum=0;
        for (int32 Index=0; Index<MoveCount; ++Index)
        {
            const auto Move=static_cast<EDotBehaviorMove>(Index);
            float Repeat=1;
            for (const auto Seen : Recent)
                if (Seen==Move) Repeat*=.16f;
            const bool bAerial=Move==EDotBehaviorMove::Spin || Move==EDotBehaviorMove::Flip ||
                Move==EDotBehaviorMove::Jump;
            const float RoomForAccent=GroovePhrases==0 ? .03f : GroovePhrases>4 ? 1.95f : 1.f;
            const float TempoFit=(Move==EDotBehaviorMove::RunningMan || Move==EDotBehaviorMove::HeelToe)
                ? FMath::GetMappedRangeValueClamped(FVector2f(95.f,143.f),FVector2f(.67f,1.25f),Bpm) : 1.f;
            Weights[Index]=(bPlaying?PlayingWeights[Index]:IdleWeights[Index])*
                (1.f+.72f*Preference[Index])*Repeat*TempoFit*(bAerial ? RoomForAccent : 1.f);
            Sum+=Weights[Index];
        }
        float Draw=Random.FRand()*Sum;
        int32 Chosen=0;
        for (int32 Index=0; Index<MoveCount; ++Index)
        {
            if (Weights[Index]>0) Chosen=Index;
            Draw-=Weights[Index];
            if (Draw<0) break;
        }
        Current=static_cast<EDotBehaviorMove>(Chosen);
        LastChoice=Current;
        if (bPlaying) RecentPerformance=Current;
        Recent.Add(Current);
        if (Recent.Num()>4) Recent.RemoveAt(0);
        TimesChosen[Chosen]=FMath::Min(1000000,TimesChosen[Chosen]+1);
        bDirty=true;
        const bool bAccent=Current==EDotBehaviorMove::Spin || Current==EDotBehaviorMove::Jump ||
            Current==EDotBehaviorMove::Flip;
        if (bPlaying) GroovePhrases=bAccent ? 0 : FMath::Min(GroovePhrases+1,8);
        PhraseBeats=bPlaying ? ((bAccent ? Bpm<=156.f : Random.FRand()<.24f) ? 4.f : 8.f)
            : Random.FRandRange(6.f,9.f);
        UE_LOG(LogTemp,Display,TEXT("DOT_BEHAVIOR move=%s context=%s"),Names[Chosen],bPlaying?TEXT("music"):TEXT("idle"));
    }
    Progress=0;
    Turns=Random.RandRange(2,3);
    Strength=Random.FRandRange(.60f,1.f);
    Side=Random.RandRange(0,1)==0?-1.f:1.f;
}

FDotBehaviorPose FDotBehavior::Tick(float DeltaSeconds, double NativeBeat, float Bpm, float Energy, bool bPlaying, bool bOccupied, bool bHandoff)
{
    const bool bContextChanged=bPlaying!=bWasPlaying || bOccupied!=bWasOccupied ||
        (bHandoff&&!bWasHandoff&&Current==EDotBehaviorMove::Hover);
    if (bPlaying)
    {
        if (!bWasPlaying) BeatClock=NativeBeat;
        else
        {
            // Track samples can jitter or jump by many bars at a deck handoff.
            // Correct the phase through speed and keep the choreography advancing.
            const double Rate=Bpm/60.0;
            const double Predicted=BeatClock+DeltaSeconds*Rate;
            const double Difference=NativeBeat-Predicted;
            const double Error=Difference-FMath::RoundToDouble(Difference);
            const double Correction=FMath::Sign(Error)*FMath::Max(0.0,FMath::Abs(Error)-.012)*3.5;
            BeatClock=Predicted+DeltaSeconds*FMath::Clamp(Correction,-Rate*.24,Rate*.24);
        }
        if (bContextChanged || BeatClock>=PhraseStart+PhraseBeats)
        {
            PhraseStart=bContextChanged ? FMath::CeilToDouble(BeatClock) : PhraseStart+PhraseBeats;
            Choose(Bpm,Energy,true,bOccupied,bHandoff);
        }
        Progress=float((BeatClock-PhraseStart)/PhraseBeats);
    }
    else
    {
        Progress+=DeltaSeconds*2.f/PhraseBeats;
        if (bContextChanged || Progress>=1) Choose(Bpm,Energy,false,bOccupied,bHandoff);
    }
    bWasPlaying=bPlaying;
    bWasOccupied=bOccupied;
    bWasHandoff=bHandoff;
    SaveAge+=DeltaSeconds;
    if (SaveAge>=30)
    {
        SaveAge=0;
        Save();
    }

    const float P=FMath::Clamp(Progress,0.f,1.f);
    const float Beat=P*PhraseBeats;
    const auto Smooth=[](float A, float B, float Value)
    {
        const float T=FMath::Clamp((Value-A)/(B-A),0.f,1.f);
        return T*T*T*(T*(T*6.f-15.f)+10.f);
    };
    const auto Wave=[](float Phase) { return FMath::Sin(UE_TWO_PI*Phase); };
    const auto Arc=[](float Phase)
    {
        const float Sine=FMath::Sin(UE_PI*Phase);
        return Sine*Sine;
    };
    const float PhraseFade=Smooth(0.f,.12f,P)*(1.f-Smooth(.86f,1.f,P));
    const float Amount=Strength*PhraseFade;
    const float Sway=Wave(Beat*.25f);
    const float Pulse=Arc(Beat*.5f);
    const float Step=Smooth(.0f,.92f,FMath::Fmod(Beat+1.f,4.f))-
        Smooth(2.f,2.92f,FMath::Fmod(Beat+1.f,4.f));
    const float Push=Side*(2.f*Step-1.f);
    // Take off and land on whole beats, including when the accent spans eight beats.
    const float AccentCount=4.f*P;
    const float Air=Smooth(1.f,1.75f,AccentCount)*(1.f-Smooth(2.22f,3.f,AccentCount));
    const float Crouch=Smooth(.35f,.79f,AccentCount)*(1.f-Smooth(.79f,1.f,AccentCount))+
        .8f*Smooth(2.84f,3.f,AccentCount)*(1.f-Smooth(3.f,3.5f,AccentCount));
    const float Revolution=Smooth(1.f,3.f,AccentCount);
    const float Bar=FMath::Fmod(Beat,4.f);
    const float LatinCount=Smooth(0,.60f,Bar)-.52f*Smooth(.92f,1.55f,Bar)
        -.48f*Smooth(1.9f,2.63f,Bar);
    const float Triplet=Smooth(0,.34f,Bar)-.48f*Smooth(.50f,.84f,Bar)
        +.40f*Smooth(1.f,1.45f,Bar)-.92f*Smooth(2.f,3.1f,Bar);
    FDotBehaviorPose Pose;
    switch (Current)
    {
        case EDotBehaviorMove::LookAround:
            Pose={8*Side,3,8*Side,-23*Side,3,0}; break;
        case EDotBehaviorMove::HeadBob:
            Pose={13*Side*Sway,6*Pulse,-4*Side*Sway,4*Side*Sway,-12*Pulse,.022f*Pulse}; break;
        case EDotBehaviorMove::TwoStep:
            Pose={76*Push,18*Arc(Beat),-17*Push,17*Push,-5*Pulse,-.025f*Pulse}; break;
        case EDotBehaviorMove::Bounce:
            Pose={44*Side*Sway,32*Pulse,-10*Side*Sway,12*Side*Sway,-9*Pulse,-.040f*Pulse}; break;
        case EDotBehaviorMove::Glide:
            Pose={124*Side*Wave(P),15*Pulse,-14*Side*Wave(P+.17f),20*Side*Wave(P+.17f),-4*Pulse,0}; break;
        case EDotBehaviorMove::BodyRoll:
            Pose={29*Side*Sway,16*Pulse,20*Side*Sway,12*Side*Sway,19*Wave(Beat*.25f+.25f),.045f*Sway}; break;
        case EDotBehaviorMove::Twist:
            Pose={42*Push,13*Pulse,-13*Side*Sway,34*Side*Wave(Beat*.5f),-8*Pulse,.035f*Sway}; break;
        case EDotBehaviorMove::Shimmy:
            Pose={54*Side*Sway+9*Side*Wave(Beat),12*Pulse,12*Side*Wave(Beat+.15f),
                12*Side*Wave(Beat+.35f),-5*Pulse,.023f*Wave(Beat)}; break;
        case EDotBehaviorMove::Jump:
            Pose={79*Side*Wave(P),78*Air-13*Crouch,15*Side*Air,22*Side*Air,
                -13*Air+15*Crouch,.115f*Air-.12f*Crouch}; break;
        case EDotBehaviorMove::Flip:
            Pose={62*Side*Wave(P),103*Air-11*Crouch,5*Side*Air,10*Side*Air,
                360*Side*Revolution,.075f*Air-.10f*Crouch,true,16*Air}; break;
        case EDotBehaviorMove::Spin:
            // Preserve the full winding through the return to the neutral pose.
            Pose={99*Side*Wave(P),45*Air-7*Crouch,9*Side*Air,
                Side*360*Turns*Revolution,-5*Air,.04f*Air-.055f*Crouch,true,20*Air}; break;
        case EDotBehaviorMove::Jack:
            Pose={32*Side*Sway,14*Arc(Beat),-10*Side*Sway,12*Side*Sway,
                21*Wave(Beat-.19f),.060f*Wave(Beat-.38f)}; break;
        case EDotBehaviorMove::Skating:
            Pose={110*Side*Wave(P),14*Pulse,-22*Side*Sway,24*Side*Sway,-7*Pulse,.018f*Pulse,false,
                24*Arc(P)}; break;
        case EDotBehaviorMove::SalsaStep:
            Pose={Side*63*LatinCount,11*Arc(Beat),-15*Side*LatinCount,30*Side*LatinCount,
                -7*Pulse,.035f*LatinCount}; break;
        case EDotBehaviorMove::HeelToe:
            Pose={56*Side*Sway,9*Arc(Beat+.25f),12*Side*Wave(Beat*.5f+.25f),
                27*Side*Wave(Beat*.5f),-7*Pulse,.024f*Pulse}; break;
        case EDotBehaviorMove::RunningMan:
            Pose={47*Push,21*Arc(Beat-.18f),-11*Push,21*Side*Wave(Beat*.25f),
                16*Wave(Beat-.11f),.049f*Wave(Beat-.40f),false,17*Pulse}; break;
        case EDotBehaviorMove::PasDeBourree:
            Pose={74*Side*Triplet,10*Pulse,-19*Side*Triplet,21*Side*Triplet,
                -6*Pulse,.031f*Triplet}; break;
        case EDotBehaviorMove::Handoff:
            Pose={16*Side*Sway,23*Pulse,9*Side*Sway,9*Side*Sway,-12*Pulse,.04f*Pulse}; break;
        default: break;
    }
    Pose={Pose.Travel*Amount,Pose.Lift*Amount,Pose.Tilt*Amount,
        Current==EDotBehaviorMove::Spin ? Pose.Turn : Pose.Turn*Amount,
        Current==EDotBehaviorMove::Flip ? Pose.Nod : Pose.Nod*Amount,
        Pose.Squash*Amount,Pose.bWinding,Pose.Depth*Amount};
    if (bPlaying)
    {
        const double Count=FMath::FloorToDouble(BeatClock);
        const float Phase=float(BeatClock-Count);
        const float Lift=Arc(Phase);
        const float Ground=1.f-Smooth(0.f,44.f,Pose.Lift);
        const float Groove=(bOccupied ? 3.5f : 10.f+8.f*Energy)*Ground;
        // A soft compression on the beat and a lift between beats carry every move.
        Pose.Lift+=Groove*(Lift-.22f);
        Pose.Nod-=Groove*.28f*(1.f-Lift);
        Pose.Squash+=Groove*.0027f*(2.f*Lift-1.f);
        if (bBeatAudit && int64(Count)!=LastAuditedBeat)
        {
            LastAuditedBeat=int64(Count);
            const double Difference=NativeBeat-BeatClock;
            UE_LOG(LogTemp,Display,TEXT("DOT_GROOVE beat=%.3f phaseError=%.3f phraseStart=%.0f bpm=%.1f move=%s occupied=%d"),
                BeatClock,Difference-FMath::RoundToDouble(Difference),PhraseStart,Bpm,
                Names[static_cast<int32>(Current)],bOccupied);
        }
    }
    else LastAuditedBeat=-1;
    return Pose;
}
